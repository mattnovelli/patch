#include <pebble.h>
#include <string.h>

#define KEY_CONTACT_INDEX 0
#define KEY_VOICE_TEXT    1
#define KEY_ERROR         2
#define KEY_STATUS        3
#define KEY_CONTACT_NAMES 4

#define SENT_STATUS_PREFIX "Email sent"

static Window *s_main_window;
static MenuLayer *s_menu_layer;
static Layer *s_empty_state_layer;

// Contact list received from JS (names only); emails live on the phone side
static char **s_contacts = NULL;
static int s_contact_count = 0;
static bool s_contacts_loaded = false;

static DictationSession *s_dictation;
static int s_selected_index = -1;

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

static void update_empty_state_visibility(void) {
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

  // Draw a simple settings icon that reinforces phone-side setup.
  GRect icon = GRect((bounds.size.w - 40) / 2, (bounds.size.h / 2) - 58, 40, 40);
  graphics_context_set_fill_color(ctx, app_accent_color());
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
                     "Get Started",
                     fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                     GRect(8, icon.origin.y + icon.size.h + 10, bounds.size.w - 16, 28),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter,
                     NULL);

  graphics_context_set_text_color(ctx, GColorLightGray);
  graphics_draw_text(ctx,
                     "Open settings in the Pebble app to add contacts.",
                     fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(10, icon.origin.y + icon.size.h + 38, bounds.size.w - 20, 70),
                     GTextOverflowModeWordWrap,
                     GTextAlignmentCenter,
                     NULL);
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

// Menu callbacks
static uint16_t menu_get_num_rows(MenuLayer *menu_layer, uint16_t section_index, void *context) {
  (void)menu_layer;
  (void)section_index;
  (void)context;

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

static void dictation_callback(DictationSession *session, DictationSessionStatus status, char *transcription, void *context) {
  if (status != DictationSessionStatusSuccess) {
    vibes_short_pulse();
    return;
  }
  // Send message to JS: contact index + voice text
  APP_LOG(APP_LOG_LEVEL_INFO, "=== SENDING MESSAGE TO JS ===");
  APP_LOG(APP_LOG_LEVEL_INFO, "Contact index: %d", s_selected_index);
  APP_LOG(APP_LOG_LEVEL_INFO, "Voice text: %s", transcription);
  
  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Failed to begin outbox: %d", (int)result);
    return;
  }
  
  dict_write_int(iter, KEY_CONTACT_INDEX, &s_selected_index, sizeof(int), true);
  dict_write_cstring(iter, KEY_VOICE_TEXT, transcription);
  
  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Failed to send message: %d", (int)result);
  } else {
    APP_LOG(APP_LOG_LEVEL_INFO, "Message sent successfully");
  }
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

static void inbox_received(DictionaryIterator *iter, void *context) {
  (void)context;

  Tuple *names = dict_find(iter, KEY_CONTACT_NAMES);
  if (names) {
    parse_contacts_string(names->value->cstring);
  }

  Tuple *status_t = dict_find(iter, KEY_STATUS);
  if (status_t) {
    const char *status_text = status_t->value->cstring;
    APP_LOG(APP_LOG_LEVEL_INFO, "Status: %s", status_text);

    if (status_text && strstr(status_text, SENT_STATUS_PREFIX)) {
      vibes_short_pulse();
    }
  }

  Tuple *error_t = dict_find(iter, KEY_ERROR);
  if (error_t) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Error: %s", error_t->value->cstring);
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

  s_main_window = window_create();
  window_set_window_handlers(s_main_window, (WindowHandlers){
    .load = main_window_load,
    .unload = main_window_unload,
  });
  window_stack_push(s_main_window, true);
}

static void deinit(void) {
  if (s_dictation) dictation_session_destroy(s_dictation);
  free_contacts();
  if (s_main_window) window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}