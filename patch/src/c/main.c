#include <pebble.h>
#include <string.h>
#include <ctype.h>

#define KEY_CONTACT_INDEX 0
#define KEY_VOICE_TEXT    1
#define KEY_ERROR         2
#define KEY_STATUS        3
#define KEY_CONTACT_NAMES 4
#define KEY_QUIT_AFTER_SEND 5
#define KEY_AUTH_STATE 6
#define KEY_CANNED_LABELS 7
#define KEY_CANNED_INDEX 8

#define AUTH_STATE_UNKNOWN 0
#define AUTH_STATE_OK 1
#define AUTH_STATE_REAUTH_REQUIRED 2

#define SENT_STATUS_PREFIX "Email sent"
#define SENT_ANIM_DELTA_MS 33
#define SENT_ANIM_END_HOLD_MS 450
#define SENT_FALLBACK_HOLD_MS 950
#define ERROR_MODAL_DISMISS_MS 3000
#define NOTICE_MODAL_DISMISS_MS 1400

typedef enum {
  AppAuthStateUnknown = AUTH_STATE_UNKNOWN,
  AppAuthStateOk = AUTH_STATE_OK,
  AppAuthStateReauthRequired = AUTH_STATE_REAUTH_REQUIRED,
} AppAuthState;

static Window *s_main_window;
static MenuLayer *s_menu_layer;
static Layer *s_empty_state_layer;
static Window *s_sent_modal_window;
static Layer *s_sent_modal_layer;
static Window *s_error_modal_window;
static Layer *s_error_modal_layer;
static Window *s_notice_modal_window;
static Layer *s_notice_modal_layer;
static Window *s_canned_window;
static MenuLayer *s_canned_menu_layer;

// Contact list received from JS (names only); emails live on the phone side
static char **s_contacts = NULL;
static int s_contact_count = 0;
static bool s_contacts_loaded = false;
static char **s_canned_labels = NULL;
static int s_canned_count = 0;
static AppAuthState s_auth_state = AppAuthStateUnknown;
static bool s_quit_after_send_enabled = false;
static bool s_pending_quit_after_send = false;

static DictationSession *s_dictation;
static int s_selected_index = -1;
static AppTimer *s_sent_modal_hide_timer;
static AppTimer *s_error_modal_timer;
static AppTimer *s_notice_modal_timer;
static bool s_sent_modal_visible = false;
static bool s_error_modal_visible = false;
static bool s_notice_modal_visible = false;
static char s_error_modal_message[96] = "Message could not be sent.";
static char s_notice_modal_message[80] = "Patch";

#ifdef PBL_COLOR
static GDrawCommandSequence *s_sent_sequence;
static AppTimer *s_sent_anim_timer;
static int s_sent_anim_frame = 0;
static bool s_sent_animating = false;
#endif

static GColor app_primary_color(void) {
#ifdef PBL_COLOR
  return GColorFromRGB(8, 31, 68);
#else
  return GColorBlack;
#endif
}

static GColor app_accent_color(void) {
#ifdef PBL_COLOR
  return GColorFromRGB(0, 122, 255);
#else
  return GColorWhite;
#endif
}

static GColor app_error_bg_color(void) {
#ifdef PBL_COLOR
  return GColorFromRGB(138, 26, 26);
#else
  return GColorBlack;
#endif
}

static bool contains_case_insensitive(const char *text, const char *needle) {
  if (!text || !needle || !*needle) {
    return false;
  }

  size_t needle_len = strlen(needle);
  for (const char *cursor = text; *cursor; cursor++) {
    size_t i = 0;
    while (i < needle_len && cursor[i]) {
      char a = (char)tolower((unsigned char)cursor[i]);
      char b = (char)tolower((unsigned char)needle[i]);
      if (a != b) {
        break;
      }
      i++;
    }

    if (i == needle_len) {
      return true;
    }
  }

  return false;
}

static void summarize_error_message(const char *raw_message, char *dest, size_t dest_len) {
  if (!dest || dest_len == 0) {
    return;
  }

  const char *summary = "Message could not be sent.";
  if (raw_message) {
    if (contains_case_insensitive(raw_message, "sign in") ||
        contains_case_insensitive(raw_message, "session expired") ||
        contains_case_insensitive(raw_message, "auth")) {
      summary = "Sign in required. Re-open Patch settings.";
    } else if (contains_case_insensitive(raw_message, "network") ||
               contains_case_insensitive(raw_message, "timeout")) {
      summary = "Connection issue. Check phone network and retry.";
    } else if (contains_case_insensitive(raw_message, "permission")) {
      summary = "Permission denied for Outlook send.";
    } else if (contains_case_insensitive(raw_message, "contact")) {
      summary = "Contact data is invalid. Update settings.";
    }
  }

  strncpy(dest, summary, dest_len - 1);
  dest[dest_len - 1] = '\0';
}

static void cancel_error_modal_timer(void) {
  if (!s_error_modal_timer) {
    return;
  }

  app_timer_cancel(s_error_modal_timer);
  s_error_modal_timer = NULL;
}

static void dismiss_error_modal(void) {
  if (!s_error_modal_visible || !s_error_modal_window) {
    return;
  }

  if (window_stack_get_top_window() == s_error_modal_window) {
    window_stack_pop(true);
  }
}

static void error_modal_timer_cb(void *context) {
  (void)context;
  s_error_modal_timer = NULL;
  dismiss_error_modal();
}

static void reset_error_modal_timer(void) {
  cancel_error_modal_timer();
  s_error_modal_timer = app_timer_register(ERROR_MODAL_DISMISS_MS, error_modal_timer_cb, NULL);
}

static void show_error_modal(const char *raw_message) {
  summarize_error_message(raw_message, s_error_modal_message, sizeof(s_error_modal_message));

  if (!s_error_modal_window) {
    return;
  }

  if (s_error_modal_visible) {
    if (s_error_modal_layer) {
      layer_mark_dirty(s_error_modal_layer);
    }
    reset_error_modal_timer();
    return;
  }

  window_stack_push(s_error_modal_window, true);
}

static void update_empty_state_visibility(void) {
  if (s_auth_state == AppAuthStateReauthRequired) {
    if (s_menu_layer) {
      layer_set_hidden(menu_layer_get_layer(s_menu_layer), true);
    }

    if (s_empty_state_layer) {
      layer_set_hidden(s_empty_state_layer, false);
      layer_mark_dirty(s_empty_state_layer);
    }
    return;
  }

  // Avoid flashing the empty-state view before the first contact sync arrives.
  if (!s_contacts_loaded) {
    if (s_menu_layer) {
      layer_set_hidden(menu_layer_get_layer(s_menu_layer), false);
    }

    if (s_empty_state_layer) {
      layer_set_hidden(s_empty_state_layer, true);
    }
    return;
  }

  bool has_contacts = s_contact_count > 0;

  if (s_menu_layer) {
    layer_set_hidden(menu_layer_get_layer(s_menu_layer), !has_contacts);
  }

  if (s_empty_state_layer) {
    layer_set_hidden(s_empty_state_layer, has_contacts);
    layer_mark_dirty(s_empty_state_layer);
  }
}

static void empty_state_layer_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);

  graphics_context_set_fill_color(ctx, app_primary_color());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  bool show_reauth = s_auth_state == AppAuthStateReauthRequired;

  // Draw a simple icon that reinforces phone-side setup/re-auth.
  GRect icon = GRect((bounds.size.w - 40) / 2, (bounds.size.h / 2) - 58, 40, 40);
  graphics_context_set_fill_color(ctx, show_reauth ? app_error_bg_color() : app_accent_color());
  graphics_fill_rect(ctx, icon, 8, GCornersAll);

  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_context_set_stroke_width(ctx, 2);

  int16_t left = icon.origin.x + 8;
  int16_t right = icon.origin.x + icon.size.w - 8;
  int16_t y1 = icon.origin.y + 11;
  int16_t y2 = icon.origin.y + 20;
  int16_t y3 = icon.origin.y + 29;

  graphics_draw_line(ctx, GPoint(left, y1), GPoint(right, y1));
  graphics_draw_line(ctx, GPoint(left, y2), GPoint(right, y2));
  graphics_draw_line(ctx, GPoint(left, y3), GPoint(right, y3));

  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_circle(ctx, GPoint(icon.origin.x + 15, y1), 2);
  graphics_fill_circle(ctx, GPoint(icon.origin.x + 25, y2), 2);
  graphics_fill_circle(ctx, GPoint(icon.origin.x + 13, y3), 2);

  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx,
                     show_reauth ? "Re-auth Required" : "Get Started",
                     fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                     GRect(8, icon.origin.y + icon.size.h + 10, bounds.size.w - 16, 28),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter,
                     NULL);

  graphics_context_set_text_color(ctx, GColorLightGray);
  graphics_draw_text(ctx,
                     show_reauth
                       ? "Open Patch settings on your phone and sign in to Outlook."
                       : "Open settings in the Pebble app to add contacts.",
                     fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(10, icon.origin.y + icon.size.h + 38, bounds.size.w - 20, 70),
                     GTextOverflowModeWordWrap,
                     GTextAlignmentCenter,
                     NULL);
}

static void maybe_quit_after_send(void) {
  if (!s_pending_quit_after_send) {
    return;
  }

  s_pending_quit_after_send = false;
  window_stack_pop_all(false);
}

#ifdef PBL_COLOR
static void sent_animation_timer_cb(void *context);
static void sent_animation_hide_cb(void *context);

static void sent_modal_layer_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, app_primary_color());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  if (!s_sent_sequence) {
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx,
                       "Sent",
                       fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
                       GRect(0, (bounds.size.h / 2) - 24, bounds.size.w, 32),
                       GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentCenter,
                       NULL);
    return;
  }

  GDrawCommandFrame *frame = gdraw_command_sequence_get_frame_by_index(s_sent_sequence, s_sent_anim_frame);
  if (!frame) {
    return;
  }

  GSize seq_size = gdraw_command_sequence_get_bounds_size(s_sent_sequence);
  GPoint origin = GPoint((bounds.size.w - seq_size.w) / 2, (bounds.size.h - seq_size.h) / 2 - 8);

  gdraw_command_frame_draw(ctx, s_sent_sequence, frame, origin);

  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx,
                     "Sent",
                     fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
                     GRect(0, bounds.size.h - 50, bounds.size.w, 30),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter,
                     NULL);
}

static void cancel_sent_modal_timers(void) {
  if (s_sent_anim_timer) {
    app_timer_cancel(s_sent_anim_timer);
    s_sent_anim_timer = NULL;
  }

  if (s_sent_modal_hide_timer) {
    app_timer_cancel(s_sent_modal_hide_timer);
    s_sent_modal_hide_timer = NULL;
  }
}

static void sent_modal_begin_animation(void) {
  if (!s_sent_modal_layer || !s_sent_sequence) {
    s_sent_modal_hide_timer = app_timer_register(SENT_FALLBACK_HOLD_MS, sent_animation_hide_cb, NULL);
    return;
  }

  cancel_sent_modal_timers();

  const int num_frames = gdraw_command_sequence_get_num_frames(s_sent_sequence);
  if (num_frames <= 0) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Sent sequence has no frames");
    s_sent_modal_hide_timer = app_timer_register(SENT_FALLBACK_HOLD_MS, sent_animation_hide_cb, NULL);
    return;
  }

  s_sent_anim_frame = 0;
  s_sent_animating = true;
  layer_mark_dirty(s_sent_modal_layer);

  if (num_frames == 1) {
    s_sent_animating = false;
    s_sent_modal_hide_timer = app_timer_register(SENT_ANIM_END_HOLD_MS, sent_animation_hide_cb, NULL);
    return;
  }

  s_sent_anim_timer = app_timer_register(SENT_ANIM_DELTA_MS, sent_animation_timer_cb, NULL);
}

static void sent_animation_timer_cb(void *context) {
  (void)context;

  if (!s_sent_animating || !s_sent_sequence || !s_sent_modal_layer) {
    s_sent_anim_timer = NULL;
    return;
  }

  const int num_frames = gdraw_command_sequence_get_num_frames(s_sent_sequence);
  if (num_frames <= 0) {
    s_sent_animating = false;
    s_sent_anim_timer = NULL;
    sent_animation_hide_cb(NULL);
    return;
  }

  s_sent_anim_frame++;
  if (s_sent_anim_frame >= num_frames - 1) {
    s_sent_animating = false;
    s_sent_anim_frame = num_frames - 1;
    s_sent_anim_timer = NULL;
    layer_mark_dirty(s_sent_modal_layer);
    s_sent_modal_hide_timer = app_timer_register(SENT_ANIM_END_HOLD_MS, sent_animation_hide_cb, NULL);
    return;
  }

  layer_mark_dirty(s_sent_modal_layer);
  s_sent_anim_timer = app_timer_register(SENT_ANIM_DELTA_MS, sent_animation_timer_cb, NULL);
}

static void sent_animation_hide_cb(void *context) {
  (void)context;

  s_sent_modal_hide_timer = NULL;
  if (!s_sent_modal_window || !s_sent_modal_visible) {
    maybe_quit_after_send();
    return;
  }

  if (window_stack_get_top_window() == s_sent_modal_window) {
    window_stack_pop(true);
  } else {
    maybe_quit_after_send();
  }
}

static void start_sent_animation(void) {
  if (!s_sent_modal_window) {
    maybe_quit_after_send();
    return;
  }

  if (s_sent_modal_visible) {
    return;
  }

  window_stack_push(s_sent_modal_window, true);
}
#else
static void sent_modal_layer_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, app_primary_color());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx,
                     "Sent",
                     fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
                     GRect(0, (bounds.size.h / 2) - 28, bounds.size.w, 32),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter,
                     NULL);

  graphics_draw_text(ctx,
                     "Message delivered",
                     fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(0, (bounds.size.h / 2) + 4, bounds.size.w, 26),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter,
                     NULL);
}

static void sent_animation_hide_cb(void *context) {
  (void)context;

  s_sent_modal_hide_timer = NULL;
  if (!s_sent_modal_window || !s_sent_modal_visible) {
    maybe_quit_after_send();
    return;
  }

  if (window_stack_get_top_window() == s_sent_modal_window) {
    window_stack_pop(true);
  } else {
    maybe_quit_after_send();
  }
}

static void start_sent_animation(void) {
  if (!s_sent_modal_window) {
    maybe_quit_after_send();
    return;
  }

  if (s_sent_modal_visible) {
    return;
  }

  window_stack_push(s_sent_modal_window, true);
}
#endif

static void sent_modal_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  window_set_background_color(window, app_primary_color());
  s_sent_modal_layer = layer_create(bounds);
  layer_set_update_proc(s_sent_modal_layer, sent_modal_layer_update_proc);
  layer_add_child(window_layer, s_sent_modal_layer);
}

static void sent_modal_window_appear(Window *window) {
  (void)window;
  s_sent_modal_visible = true;

#ifdef PBL_COLOR
  sent_modal_begin_animation();
#else
  if (s_sent_modal_hide_timer) {
    app_timer_cancel(s_sent_modal_hide_timer);
    s_sent_modal_hide_timer = NULL;
  }
  s_sent_modal_hide_timer = app_timer_register(SENT_FALLBACK_HOLD_MS, sent_animation_hide_cb, NULL);
#endif

  if (s_sent_modal_layer) {
    layer_mark_dirty(s_sent_modal_layer);
  }
}

static void sent_modal_window_disappear(Window *window) {
  (void)window;
  s_sent_modal_visible = false;

  if (s_sent_modal_hide_timer) {
    app_timer_cancel(s_sent_modal_hide_timer);
    s_sent_modal_hide_timer = NULL;
  }

#ifdef PBL_COLOR
  cancel_sent_modal_timers();
  s_sent_animating = false;
  s_sent_anim_frame = 0;
#endif

  maybe_quit_after_send();
}

static void sent_modal_window_unload(Window *window) {
  (void)window;

  if (s_sent_modal_layer) {
    layer_destroy(s_sent_modal_layer);
    s_sent_modal_layer = NULL;
  }
}

static void error_modal_layer_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);

  graphics_context_set_fill_color(ctx, app_error_bg_color());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx,
                     "Send Failed",
                     fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                     GRect(6, 14, bounds.size.w - 12, 34),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter,
                     NULL);

  graphics_draw_text(ctx,
                     s_error_modal_message,
                     fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(10, 54, bounds.size.w - 20, bounds.size.h - 78),
                     GTextOverflowModeWordWrap,
                     GTextAlignmentCenter,
                     NULL);
}

static void error_modal_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  window_set_background_color(window, app_error_bg_color());
  s_error_modal_layer = layer_create(bounds);
  layer_set_update_proc(s_error_modal_layer, error_modal_layer_update_proc);
  layer_add_child(window_layer, s_error_modal_layer);
}

static void error_modal_window_appear(Window *window) {
  (void)window;
  s_error_modal_visible = true;
  reset_error_modal_timer();

  if (s_error_modal_layer) {
    layer_mark_dirty(s_error_modal_layer);
  }
}

static void error_modal_window_disappear(Window *window) {
  (void)window;
  s_error_modal_visible = false;
  cancel_error_modal_timer();
}

static void error_modal_window_unload(Window *window) {
  (void)window;

  if (s_error_modal_layer) {
    layer_destroy(s_error_modal_layer);
    s_error_modal_layer = NULL;
  }
}

static void cancel_notice_modal_timer(void) {
  if (!s_notice_modal_timer) {
    return;
  }

  app_timer_cancel(s_notice_modal_timer);
  s_notice_modal_timer = NULL;
}

static void dismiss_notice_modal(void) {
  if (!s_notice_modal_visible || !s_notice_modal_window) {
    return;
  }

  if (window_stack_get_top_window() == s_notice_modal_window) {
    window_stack_pop(true);
  }
}

static void notice_modal_timer_cb(void *context) {
  (void)context;
  s_notice_modal_timer = NULL;
  dismiss_notice_modal();
}

static void reset_notice_modal_timer(void) {
  cancel_notice_modal_timer();
  s_notice_modal_timer = app_timer_register(NOTICE_MODAL_DISMISS_MS, notice_modal_timer_cb, NULL);
}

static void show_notice_modal(const char *message) {
  if (message && *message) {
    strncpy(s_notice_modal_message, message, sizeof(s_notice_modal_message) - 1);
    s_notice_modal_message[sizeof(s_notice_modal_message) - 1] = '\0';
  }

  if (!s_notice_modal_window) {
    return;
  }

  if (s_notice_modal_visible) {
    if (s_notice_modal_layer) {
      layer_mark_dirty(s_notice_modal_layer);
    }
    reset_notice_modal_timer();
    return;
  }

  window_stack_push(s_notice_modal_window, true);
}

static void notice_modal_layer_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);

  graphics_context_set_fill_color(ctx, app_primary_color());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx,
                     "Patch",
                     fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                     GRect(6, 14, bounds.size.w - 12, 30),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter,
                     NULL);

  graphics_draw_text(ctx,
                     s_notice_modal_message,
                     fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(10, 50, bounds.size.w - 20, bounds.size.h - 66),
                     GTextOverflowModeWordWrap,
                     GTextAlignmentCenter,
                     NULL);
}

static void notice_modal_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  window_set_background_color(window, app_primary_color());
  s_notice_modal_layer = layer_create(bounds);
  layer_set_update_proc(s_notice_modal_layer, notice_modal_layer_update_proc);
  layer_add_child(window_layer, s_notice_modal_layer);
}

static void notice_modal_window_appear(Window *window) {
  (void)window;
  s_notice_modal_visible = true;
  reset_notice_modal_timer();

  if (s_notice_modal_layer) {
    layer_mark_dirty(s_notice_modal_layer);
  }
}

static void notice_modal_window_disappear(Window *window) {
  (void)window;
  s_notice_modal_visible = false;
  cancel_notice_modal_timer();
}

static void notice_modal_window_unload(Window *window) {
  (void)window;

  if (s_notice_modal_layer) {
    layer_destroy(s_notice_modal_layer);
    s_notice_modal_layer = NULL;
  }
}

static void free_contacts() {
  if (!s_contacts) return;
  for (int i = 0; i < s_contact_count; i++) {
    if (s_contacts[i]) free(s_contacts[i]);
  }
  free(s_contacts);
  s_contacts = NULL;
  s_contact_count = 0;
}

static void parse_contacts_string(const char *str) {
  s_contacts_loaded = true;
  free_contacts();
  if (!str || !*str) {
    if (s_menu_layer) {
      menu_layer_reload_data(s_menu_layer);
    }
    update_empty_state_visibility();
    return;
  }
  // Count lines
  int count = 1;
  for (const char *p = str; *p; p++) if (*p == '\n') count++;
  s_contacts = calloc(count, sizeof(char*));
  s_contact_count = 0;

  const char *start = str;
  const char *p = str;
  while (*p) {
    if (*p == '\n') {
      int len = p - start;
      if (len > 0) {
        s_contacts[s_contact_count] = malloc(len + 1);
        memcpy(s_contacts[s_contact_count], start, len);
        s_contacts[s_contact_count][len] = '\0';
        s_contact_count++;
      }
      start = p + 1;
    }
    p++;
  }
  // Last line
  if (p != start) {
    int len = p - start;
    s_contacts[s_contact_count] = malloc(len + 1);
    memcpy(s_contacts[s_contact_count], start, len);
    s_contacts[s_contact_count][len] = '\0';
    s_contact_count++;
  }

  if (s_menu_layer) {
    menu_layer_reload_data(s_menu_layer);
  }
  update_empty_state_visibility();
}

static void free_canned_labels(void) {
  if (!s_canned_labels) {
    return;
  }

  for (int i = 0; i < s_canned_count; i++) {
    if (s_canned_labels[i]) {
      free(s_canned_labels[i]);
    }
  }

  free(s_canned_labels);
  s_canned_labels = NULL;
  s_canned_count = 0;
}

static void parse_canned_labels_string(const char *str) {
  free_canned_labels();

  if (!str || !*str) {
    if (s_canned_menu_layer) {
      menu_layer_reload_data(s_canned_menu_layer);
    }
    return;
  }

  int count = 1;
  for (const char *p = str; *p; p++) {
    if (*p == '\n') {
      count++;
    }
  }

  s_canned_labels = calloc(count, sizeof(char *));
  s_canned_count = 0;

  const char *start = str;
  const char *p = str;
  while (*p) {
    if (*p == '\n') {
      int len = p - start;
      if (len > 0) {
        s_canned_labels[s_canned_count] = malloc((size_t)len + 1);
        memcpy(s_canned_labels[s_canned_count], start, (size_t)len);
        s_canned_labels[s_canned_count][len] = '\0';
        s_canned_count++;
      }
      start = p + 1;
    }
    p++;
  }

  if (p != start) {
    int len = p - start;
    s_canned_labels[s_canned_count] = malloc((size_t)len + 1);
    memcpy(s_canned_labels[s_canned_count], start, (size_t)len);
    s_canned_labels[s_canned_count][len] = '\0';
    s_canned_count++;
  }

  if (s_canned_menu_layer) {
    menu_layer_reload_data(s_canned_menu_layer);
  }
}

// Menu callbacks
static uint16_t menu_get_num_rows(MenuLayer *menu_layer, uint16_t section_index, void *context) {
  (void)menu_layer;
  (void)section_index;
  (void)context;

  if (s_auth_state == AppAuthStateReauthRequired) {
    return 0;
  }

  if (!s_contacts_loaded) {
    return 1;
  }

  return (uint16_t)s_contact_count;
}

static void menu_draw_row(GContext *ctx, const Layer *cell_layer, MenuIndex *index, void *context) {
  (void)context;

  if (!s_contacts_loaded) {
    menu_cell_basic_draw(ctx, cell_layer, "Loading contacts...", NULL, NULL);
    return;
  }

  menu_cell_basic_draw(ctx, cell_layer, s_contacts[index->row], NULL, NULL);
}

static bool send_message_request_to_js(int contact_index,
                                       const char *voice_text,
                                       bool include_voice_text,
                                       int canned_index,
                                       bool include_canned_index) {
  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Failed to begin outbox: %d", (int)result);
    return false;
  }

  dict_write_int(iter, KEY_CONTACT_INDEX, &contact_index, sizeof(contact_index), true);

  if (include_voice_text && voice_text && *voice_text) {
    dict_write_cstring(iter, KEY_VOICE_TEXT, voice_text);
  }

  if (include_canned_index) {
    dict_write_int(iter, KEY_CANNED_INDEX, &canned_index, sizeof(canned_index), true);
  }

  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Failed to send message: %d", (int)result);
    return false;
  }

  APP_LOG(APP_LOG_LEVEL_INFO, "Message request sent successfully");
  return true;
}

static void dictation_callback(DictationSession *session, DictationSessionStatus status, char *transcription, void *context) {
  (void)session;
  (void)context;

  if (status != DictationSessionStatusSuccess) {
    vibes_short_pulse();
    return;
  }
  // Send message to JS: contact index + voice text
  APP_LOG(APP_LOG_LEVEL_INFO, "=== SENDING MESSAGE TO JS ===");
  APP_LOG(APP_LOG_LEVEL_INFO, "Contact index: %d", s_selected_index);
  APP_LOG(APP_LOG_LEVEL_INFO, "Voice text: %s", transcription);

  send_message_request_to_js(s_selected_index, transcription, true, -1, false);
}

static void menu_select_click(MenuLayer *menu_layer, MenuIndex *index, void *context) {
  (void)menu_layer;
  (void)context;
  if (s_contact_count == 0) return;
  s_selected_index = index->row;

  if (!s_dictation) {
    s_dictation = dictation_session_create(256, dictation_callback, NULL);
    if (s_dictation) {
      // Use Pebble's native dictation confirmation UI (paper-airplane send affordance).
      dictation_session_enable_confirmation(s_dictation, true);
    }
  }
  dictation_session_start(s_dictation);
}

static uint16_t canned_menu_get_num_rows(MenuLayer *menu_layer, uint16_t section_index, void *context) {
  (void)menu_layer;
  (void)section_index;
  (void)context;
  return s_canned_count > 0 ? (uint16_t)s_canned_count : 1;
}

static void canned_menu_draw_row(GContext *ctx, const Layer *cell_layer, MenuIndex *index, void *context) {
  (void)context;

  if (s_canned_count <= 0) {
    menu_cell_basic_draw(ctx, cell_layer, "No canned messages", "Add them in settings", NULL);
    return;
  }

  menu_cell_basic_draw(ctx, cell_layer, s_canned_labels[index->row], NULL, NULL);
}

static void canned_menu_select_click(MenuLayer *menu_layer, MenuIndex *index, void *context) {
  (void)menu_layer;
  (void)context;

  if (index->row >= s_canned_count || s_selected_index < 0 || s_selected_index >= s_contact_count) {
    vibes_short_pulse();
    return;
  }

  int canned_index = index->row;
  bool queued = send_message_request_to_js(s_selected_index, NULL, false, canned_index, true);
  if (!queued) {
    show_notice_modal("Unable to queue canned send.");
    vibes_long_pulse();
    return;
  }

  window_stack_pop(true);
}

static void menu_select_long_click(MenuLayer *menu_layer, MenuIndex *index, void *context) {
  (void)menu_layer;
  (void)context;

  if (s_auth_state == AppAuthStateReauthRequired || s_contact_count <= 0) {
    vibes_short_pulse();
    return;
  }

  s_selected_index = index->row;
  if (s_canned_count <= 0 || !s_canned_window) {
    show_notice_modal("No canned messages in settings.");
    vibes_short_pulse();
    return;
  }

  if (s_canned_menu_layer) {
    menu_layer_reload_data(s_canned_menu_layer);
    MenuIndex selected = (MenuIndex){ .section = 0, .row = 0 };
    menu_layer_set_selected_index(s_canned_menu_layer, selected, MenuRowAlignCenter, false);
  }

  window_stack_push(s_canned_window, true);
}

static void canned_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  window_set_background_color(window, app_primary_color());
  s_canned_menu_layer = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_canned_menu_layer, NULL, (MenuLayerCallbacks){
    .get_num_rows = canned_menu_get_num_rows,
    .draw_row = canned_menu_draw_row,
    .select_click = canned_menu_select_click,
  });
  menu_layer_set_normal_colors(s_canned_menu_layer, GColorWhite, GColorBlack);
  menu_layer_set_highlight_colors(s_canned_menu_layer, app_accent_color(), GColorWhite);
  menu_layer_set_click_config_onto_window(s_canned_menu_layer, window);
  layer_add_child(window_layer, menu_layer_get_layer(s_canned_menu_layer));
}

static void canned_window_appear(Window *window) {
  (void)window;
  if (s_canned_menu_layer) {
    menu_layer_reload_data(s_canned_menu_layer);
  }
}

static void canned_window_unload(Window *window) {
  (void)window;

  if (s_canned_menu_layer) {
    menu_layer_destroy(s_canned_menu_layer);
    s_canned_menu_layer = NULL;
  }
}

static void inbox_received(DictionaryIterator *iter, void *context) {
  (void)context;

  Tuple *auth_state_t = dict_find(iter, KEY_AUTH_STATE);
  if (auth_state_t) {
    int32_t raw_state = auth_state_t->value->int32;
    AppAuthState next_state = AppAuthStateUnknown;
    if (raw_state == AUTH_STATE_REAUTH_REQUIRED) {
      next_state = AppAuthStateReauthRequired;
    } else if (raw_state == AUTH_STATE_OK) {
      next_state = AppAuthStateOk;
    }

    if (s_auth_state != next_state) {
      s_auth_state = next_state;
      update_empty_state_visibility();
    }
  }

  Tuple *quit_after_send_t = dict_find(iter, KEY_QUIT_AFTER_SEND);
  if (quit_after_send_t) {
    s_quit_after_send_enabled = quit_after_send_t->value->int32 != 0;
    APP_LOG(APP_LOG_LEVEL_INFO, "Quit after send: %s", s_quit_after_send_enabled ? "enabled" : "disabled");
  }

  Tuple *names = dict_find(iter, KEY_CONTACT_NAMES);
  if (names) {
    parse_contacts_string(names->value->cstring);
  }

  Tuple *canned_labels = dict_find(iter, KEY_CANNED_LABELS);
  if (canned_labels) {
    parse_canned_labels_string(canned_labels->value->cstring);
  }

  Tuple *status_t = dict_find(iter, KEY_STATUS);
  if (status_t) {
    const char *status_text = status_t->value->cstring;
    APP_LOG(APP_LOG_LEVEL_INFO, "Status: %s", status_text);

    if (status_text && strstr(status_text, SENT_STATUS_PREFIX)) {
      vibes_short_pulse();
      s_pending_quit_after_send = s_quit_after_send_enabled;
      start_sent_animation();
    }
  }

  Tuple *error_t = dict_find(iter, KEY_ERROR);
  if (error_t) {
    const char *error_text = error_t->value->cstring;
    s_pending_quit_after_send = false;
    APP_LOG(APP_LOG_LEVEL_ERROR, "Error: %s", error_text);

    if (contains_case_insensitive(error_text, "sign in") ||
        contains_case_insensitive(error_text, "session expired")) {
      s_auth_state = AppAuthStateReauthRequired;
      update_empty_state_visibility();
    }

    show_error_modal(error_text);
    vibes_long_pulse();
  }
}

static void main_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  window_set_background_color(window, app_primary_color());

  s_menu_layer = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_menu_layer, NULL, (MenuLayerCallbacks){
    .get_num_rows = menu_get_num_rows,
    .draw_row = menu_draw_row,
    .select_click = menu_select_click,
    .select_long_click = menu_select_long_click,
  });
  menu_layer_set_normal_colors(s_menu_layer, GColorWhite, GColorBlack);
  menu_layer_set_highlight_colors(s_menu_layer, app_accent_color(), GColorWhite);
  menu_layer_set_click_config_onto_window(s_menu_layer, window);
  layer_add_child(window_layer, menu_layer_get_layer(s_menu_layer));

  s_empty_state_layer = layer_create(bounds);
  layer_set_update_proc(s_empty_state_layer, empty_state_layer_update_proc);
  layer_add_child(window_layer, s_empty_state_layer);

  update_empty_state_visibility();
}

static void main_window_unload(Window *window) {
  (void)window;

#ifdef PBL_COLOR
  cancel_sent_modal_timers();
  s_sent_animating = false;
#endif

  if (s_empty_state_layer) {
    layer_destroy(s_empty_state_layer);
    s_empty_state_layer = NULL;
  }

  if (s_menu_layer) {
    menu_layer_destroy(s_menu_layer);
  }
  s_menu_layer = NULL;
}

static void outbox_sent(DictionaryIterator *iter, void *context) {
  (void)iter;
  (void)context;
  APP_LOG(APP_LOG_LEVEL_INFO, "Outbox message sent successfully");
}

static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  (void)iter;
  (void)context;
  APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox send failed: %d", (int)reason);
}

static void init(void) {
  app_message_register_inbox_received(inbox_received);
  app_message_register_outbox_sent(outbox_sent);
  app_message_register_outbox_failed(outbox_failed);
  app_message_open(512, 512);

#ifdef PBL_COLOR
  s_sent_sequence = gdraw_command_sequence_create_with_resource(RESOURCE_ID_SENT_SEQUENCE);
  if (!s_sent_sequence) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Failed to load sent sequence resource");
  } else {
    APP_LOG(APP_LOG_LEVEL_INFO, "Sent sequence loaded with %d frames", gdraw_command_sequence_get_num_frames(s_sent_sequence));
  }
#endif

  s_sent_modal_window = window_create();
  window_set_window_handlers(s_sent_modal_window, (WindowHandlers){
    .load = sent_modal_window_load,
    .appear = sent_modal_window_appear,
    .disappear = sent_modal_window_disappear,
    .unload = sent_modal_window_unload,
  });

  s_error_modal_window = window_create();
  window_set_window_handlers(s_error_modal_window, (WindowHandlers){
    .load = error_modal_window_load,
    .appear = error_modal_window_appear,
    .disappear = error_modal_window_disappear,
    .unload = error_modal_window_unload,
  });

  s_notice_modal_window = window_create();
  window_set_window_handlers(s_notice_modal_window, (WindowHandlers){
    .load = notice_modal_window_load,
    .appear = notice_modal_window_appear,
    .disappear = notice_modal_window_disappear,
    .unload = notice_modal_window_unload,
  });

  s_canned_window = window_create();
  window_set_window_handlers(s_canned_window, (WindowHandlers){
    .load = canned_window_load,
    .appear = canned_window_appear,
    .unload = canned_window_unload,
  });

  s_main_window = window_create();
  window_set_window_handlers(s_main_window, (WindowHandlers){
    .load = main_window_load,
    .unload = main_window_unload,
  });
  window_stack_push(s_main_window, true);
}

static void deinit(void) {
#ifdef PBL_COLOR
  cancel_sent_modal_timers();

  if (s_sent_sequence) {
    gdraw_command_sequence_destroy(s_sent_sequence);
    s_sent_sequence = NULL;
  }
#endif

  if (s_sent_modal_hide_timer) {
    app_timer_cancel(s_sent_modal_hide_timer);
    s_sent_modal_hide_timer = NULL;
  }

  cancel_error_modal_timer();
  cancel_notice_modal_timer();

  if (s_dictation) dictation_session_destroy(s_dictation);
  free_contacts();
  free_canned_labels();

  if (s_canned_window) {
    window_destroy(s_canned_window);
    s_canned_window = NULL;
  }

  if (s_notice_modal_window) {
    window_destroy(s_notice_modal_window);
    s_notice_modal_window = NULL;
  }

  if (s_error_modal_window) {
    window_destroy(s_error_modal_window);
    s_error_modal_window = NULL;
  }

  if (s_sent_modal_window) {
    window_destroy(s_sent_modal_window);
    s_sent_modal_window = NULL;
  }

  if (s_main_window) window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}