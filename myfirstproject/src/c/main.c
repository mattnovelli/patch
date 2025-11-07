#include <pebble.h>

#define KEY_CONTACT_INDEX 0
#define KEY_VOICE_TEXT    1
#define KEY_ERROR         2
#define KEY_STATUS        3
#define KEY_CONTACT_NAMES 4

static Window *s_main_window;
static MenuLayer *s_menu_layer;

// Contact list received from JS (names only); emails live on the phone side
static char **s_contacts = NULL;
static int s_contact_count = 0;

static DictationSession *s_dictation;
static int s_selected_index = -1;

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
  free_contacts();
  if (!str || !*str) {
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

  if (s_menu_layer) menu_layer_reload_data(s_menu_layer);
}

// Menu callbacks
static uint16_t menu_get_num_rows(MenuLayer *menu_layer, uint16_t section_index, void *context) {
  return s_contact_count > 0 ? s_contact_count : 1; // show a single placeholder row
}

static void menu_draw_row(GContext *ctx, const Layer *cell_layer, MenuIndex *index, void *context) {
  if (s_contact_count == 0) {
    menu_cell_basic_draw(ctx, cell_layer, "Loading contacts…", NULL, NULL);
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
  if (s_contact_count == 0) return;
  s_selected_index = index->row;

  if (!s_dictation) {
    s_dictation = dictation_session_create(256, dictation_callback, NULL);
  }
  dictation_session_start(s_dictation);
}

static void inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *names = dict_find(iter, KEY_CONTACT_NAMES);
  if (names) {
    parse_contacts_string(names->value->cstring);
  }

  Tuple *status_t = dict_find(iter, KEY_STATUS);
  if (status_t) {
    // Show a quick status
    APP_LOG(APP_LOG_LEVEL_INFO, "Status: %s", status_t->value->cstring);
    vibes_short_pulse();
  }

  Tuple *error_t = dict_find(iter, KEY_ERROR);
  if (error_t) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Error: %s", error_t->value->cstring);
    vibes_double_pulse();
  }
}

static void main_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_menu_layer = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_menu_layer, NULL, (MenuLayerCallbacks){
    .get_num_rows = menu_get_num_rows,
    .draw_row = menu_draw_row,
    .select_click = menu_select_click,
  });
  menu_layer_set_click_config_onto_window(s_menu_layer, window);
  layer_add_child(window_layer, menu_layer_get_layer(s_menu_layer));
}

static void main_window_unload(Window *window) {
  if (s_menu_layer) menu_layer_destroy(s_menu_layer);
  s_menu_layer = NULL;
}

static void outbox_sent(DictionaryIterator *iter, void *context) {
  APP_LOG(APP_LOG_LEVEL_INFO, "Outbox message sent successfully");
}

static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
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