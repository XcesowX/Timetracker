/* Dùng chung cho background, content script và các trang của extension.
   Dùng var để file có thể được nạp lại mà không lỗi khai báo trùng. */

var TG_DEFAULTS = {
  language: "vi",            // ngôn ngữ giao diện: "vi" (tiếng Việt, mặc định) hoặc "en" (tiếng Anh)
  // Trang Emplanner có đồng hồ time tracker
  workUrl: "https://app-ui.emplanner.team/ui/work",
  // Trang lịch: Finish xong thì thời gian tracked của ngày được lưu ở đây
  scheduleUrl: "https://app-ui.emplanner.team/ui/schedule/",
  // Biểu thức (regex) lấy mã order từ URL. Nhóm (...) đầu tiên là mã order.
  // CẦN XÁC NHẬN: đây là phỏng đoán, hãy sửa theo URL thật của trang order.
  // Dự phòng: chỉ dùng khi không đọc được số order trên trang.
  // Số order chính được đọc từ tiêu đề FP Editor ("1566383 DS - 2 FP Editor")
  // và từ trang order ("Floor plan orderID 1566383").
  orderUrlPatterns: [
    "[?&](?:orderId|order)=(\\d{5,})(?:&|$)"
  ],
  // Các trang web khác dùng để làm tour (dạng https://*.ten-mien.com/*)
  extraSites: [],
  idleSeconds: 180,          // không thao tác bao lâu thì cảnh báo
  graceSeconds: 60,          // thời gian chờ phản hồi trước khi tự dừng
  untrackedSeconds: 10,      // làm order bao lâu khi đồng hồ tắt thì nhắc (10 giây)
  noOrderSeconds: 180,       // đồng hồ chạy mà không làm order/survey bao lâu thì cảnh báo
  noOrderGraceSeconds: 60,   // sau cảnh báo, chờ bao lâu thì tự tạm dừng
  activeWindowSeconds: 90,   // sau lần thao tác cuối, vẫn tính là đang làm trong bao lâu
  stopAction: "pause",       // "pause" hoặc "finish"
  surveyMaxMinutes: 480,     // chế độ survey tự tắt sau bao lâu (8 tiếng, người dùng đã chốt)
  labels: {
    start: ["start", "resume", "bắt đầu", "tiếp tục"],
    pause: ["pause", "tạm dừng"],
    finish: ["finish", "kết thúc"],
    finishConfirm: ["finish", "confirm", "yes", "ok", "xác nhận", "đồng ý"],
    justLog: ["just log time"],
    finishLog: ["finish drawing & log time"],  // nút Finish trên trang order (đọc trên trang thật 2026-10-29)
    // Nút bị làm mờ, không cho bấm (người dùng đã chốt). So khớp đúng nguyên chữ trên nút
    blocked: ["log time and unassign from me", "skip"]
  },
  // Bộ chọn CSS nút đồng hồ trên trang Work (đã kiểm tra với Emplanner v2.117).
  // Khi đồng hồ chạy, nút Pause chính là nút hiện giờ (vd 00:44:03).
  selectors: {
    widget: "[class*='btn-action--']",
    start: ".btn-action--play, .btn-action--start, .btn-action--resume",
    pause: ".btn-action--pause",
    finish: ".btn-action--stop",
    scheduleToday: ".today-circle",        // số ngày hôm nay trên lịch
    scheduleTracked: ".c-secondary"        // phần tracked sau dấu "·", vd "08h 00m"
  }
};

var TG_EVENTS = {
  tracker_on: "Bật đồng hồ",
  tracker_off: "Tạm dừng đồng hồ",
  tracker_finish: "Finish, tổng kết phiên",
  tracker_remote: "Bấm đồng hồ từ Time Guard",
  tracker_mismatch: "Đồng hồ bị bấm ở nơi khác",
  survey_start: "Bắt đầu survey",
  survey_end: "Kết thúc survey",
  survey_fp: "Làm FP trong lúc survey",
  schedule_check: "Kiểm tra Schedule",
  schedule_check_failed: "Không đọc được Schedule",
  survey_untracked: "Survey khi đồng hồ tắt",
  idle_warning: "Cảnh báo không thao tác",
  idle_resumed: "Đã phản hồi",
  noorder_warning: "Đồng hồ chạy, không làm order",
  noorder_resumed: "Đã quay lại làm order",
  auto_stop: "Tự dừng đồng hồ",
  auto_stop_failed: "Tự dừng thất bại",
  untracked_work: "Làm khi đồng hồ tắt",
  multi_order: "Mở nhiều order",
  multi_order_resolved: "Còn 1 order",
  multi_order_detail: "Chi tiết lúc mở nhiều order",
  just_log_view: "Xem giờ khi Just log time",
  log_time: "Log time",
  day_carry: "Sang ngày khi chưa Finish",
  day_summary: "Tổng kết ngày"
};

var TG_EVENTS_EN = {
  tracker_on: "Tracker started",
  tracker_off: "Tracker paused",
  tracker_finish: "Finish, session summary",
  tracker_remote: "Tracker toggled via Time Guard",
  tracker_mismatch: "Tracker toggled elsewhere",
  survey_start: "Survey started",
  survey_end: "Survey ended",
  survey_fp: "Working on FP during survey",
  schedule_check: "Check Schedule",
  schedule_check_failed: "Failed to read Schedule",
  survey_untracked: "Survey with clock off",
  idle_warning: "Inactivity warning",
  idle_resumed: "Resumed activity",
  noorder_warning: "Clock running, no active order",
  noorder_resumed: "Resumed working on order",
  auto_stop: "Auto-stop tracker",
  auto_stop_failed: "Auto-stop failed",
  untracked_work: "Working with clock off",
  multi_order: "Multiple orders open",
  multi_order_resolved: "Back to 1 order",
  multi_order_detail: "Multi-order details",
  just_log_view: "View time for Just log time",
  log_time: "Log time",
  day_carry: "New day before Finish",
  day_summary: "Day summary"
};

function tgEventName(type, lang) {
  if (lang === "en") return TG_EVENTS_EN[type] || TG_EVENTS[type] || type;
  return TG_EVENTS[type] || type;
}

var TG_I18N = {
  vi: {
    // Options
    opt_page_title: "Cài đặt Time Guard",
    opt_reset: "Khôi phục mặc định",
    opt_save: "Lưu cài đặt",
    opt_general_legend: "Cài đặt chung",
    opt_lang_label: "Ngôn ngữ",
    opt_lang_vi: "Tiếng Việt",
    opt_lang_en: "English",
    opt_emp_legend: "Emplanner",
    opt_work_url: "Trang có đồng hồ time tracker",
    opt_schedule_url: "Trang Schedule (đọc thời gian tracked đã lưu)",
    opt_order_legend: "Nhận diện order",
    opt_order_patterns: "Mẫu dự phòng lấy mã order từ URL, mỗi dòng một mẫu",
    opt_order_patterns_hint: "Extension đọc số order từ tiêu đề FP Editor và từ trang order trước. Mẫu này chỉ dùng khi không đọc được. Phần trong ngoặc ( ) đầu tiên là mã order.",
    opt_test_url: "Thử với một URL",
    opt_test_url_ph: "Dán URL trang order vào đây",
    opt_extra_sites: "Trang web tour khác (ngoài Emplanner), mỗi dòng một trang",
    opt_extra_sites_ph: "https://*.ten-mien.com/*",
    opt_extra_sites_hint: "Khi lưu, trình duyệt sẽ hỏi quyền truy cập các trang này.",
    opt_timing_legend: "Thời gian",
    opt_idle_sec: "Không thao tác bao lâu thì cảnh báo (giây)",
    opt_grace_sec: "Chờ phản hồi trước khi tự dừng (giây)",
    opt_untracked_sec: "Làm order khi đồng hồ tắt bao lâu thì nhắc (giây)",
    opt_active_window_sec: "Sau thao tác cuối vẫn tính là đang làm (giây)",
    opt_no_order_sec: "Đồng hồ chạy mà không làm order/survey bao lâu thì cảnh báo (giây)",
    opt_no_order_grace_sec: "Sau cảnh báo đó, chờ bao lâu thì tự dừng (giây)",
    opt_survey_max_min: "Chế độ survey tự tắt sau (phút)",
    opt_stop_action: "Khi trainee không phản hồi",
    opt_stop_action_pause: "Tạm dừng đồng hồ (Pause)",
    opt_stop_action_finish: "Kết thúc đồng hồ (Finish)",
    opt_buttons_legend: "Nút trên Emplanner",
    opt_buttons_hint: "Chữ hiển thị trên nút, cách nhau bằng dấu phẩy. Nếu nút chỉ có biểu tượng, điền bộ chọn CSS. Dùng nút \"Kiểm tra trang này\" trong popup để xem các nút extension thấy được.",
    opt_l_start: "Nút Start",
    opt_s_start: "Bộ chọn CSS nút Start",
    opt_l_pause: "Nút Pause",
    opt_s_pause: "Bộ chọn CSS nút Pause",
    opt_l_finish: "Nút Finish",
    opt_s_finish: "Bộ chọn CSS nút Finish",
    opt_s_widget: "Bộ chọn CSS khối đồng hồ",
    opt_s_widget_hint: "Có khối này mà không có nút Pause thì tính là đồng hồ đang dừng.",
    opt_l_finish_confirm: "Nút xác nhận khi Finish",
    opt_l_just_log: "Nút Just log time",
    opt_pattern_err: "Mẫu bị lỗi: ",
    opt_order_id: "Mã order: #",
    opt_no_order_id: "Không lấy được mã order từ URL này.",
    opt_extra_sites_err: "Trang tour khác phải có dạng https://*.ten-mien.com/* : ",
    opt_perm_err: "Chưa được cấp quyền cho trang tour khác, nên chưa lưu.",
    opt_saved: "Đã lưu cài đặt thành công.",
    opt_reset_done: "Đã điền giá trị mặc định. Bấm Lưu cài đặt để áp dụng.",

    // Popup
    pop_title: "Time Guard",
    pop_loading: "Đang tải…",
    pop_running: "Đồng hồ đang chạy",
    pop_stopped: "Đồng hồ đang tạm dừng",
    pop_finished: "Đồng hồ đã kết thúc (Finish)",
    pop_unknown: "Chưa đọc được đồng hồ",
    pop_tracked_note: "Đang mở trang Work ẩn để đọc đồng hồ. Nếu lâu, hãy kiểm tra đăng nhập Emplanner.",
    pop_btn_start: "▶ Bật đồng hồ",
    pop_btn_pause: "⏸ Tạm dừng đồng hồ",
    pop_btn_clicking: "Đang bấm trên Emplanner…",
    pop_err_toggle: "Không bấm được đồng hồ: {err}. Hãy mở trang Work bấm thủ công.",
    pop_btn_survey_start: "Bắt đầu làm survey",
    pop_btn_survey_end: "Kết thúc survey",
    pop_survey_active: "Đang làm survey {min} phút (tự tắt sau {left} phút). Không tính giờ vào tour.",
    pop_survey_done: "Hôm nay đã làm survey {min} phút.",
    pop_survey_idle: "Bấm khi làm survey/quiz ngoài Emplanner để không bị cảnh báo.",
    pop_today_orders: "Thời gian theo order hôm nay",
    pop_orders_empty: "Chưa có thời gian nào. Mở một order và bật đồng hồ để bắt đầu tính.",
    pop_tag_working: "đang làm",
    pop_tag_multi: "gồm {min} phút lúc mở nhiều order",
    pop_tag_untracked: "{min} phút đồng hồ tắt",
    pop_unit_min: "phút",
    pop_btn_journal: "Mở nhật ký",
    pop_btn_check: "Kiểm tra trang này",
    pop_btn_options: "Setting",
    pop_btn_copy_diag: "Sao chép kết quả kiểm tra",
    pop_btn_copied: "Đã sao chép",
    pop_alert_no_order: "Đồng hồ đang chạy nhưng chưa mở order/survey. Sẽ tự tạm dừng nếu không thao tác.",
    pop_alert_idle: "Đang cảnh báo không thao tác. Di chuột trên Emplanner để tiếp tục.",
    pop_alert_multi: "Đang mở {count} order ({orders}). Hãy đóng bớt, chỉ giữ 1 order.",
    pop_diag_not_running: "Extension không chạy trên trang này (không thuộc Emplanner hoặc chưa khai báo trong Setting). Nếu vừa cài, hãy tải lại trang (F5).",
    pop_diag_page: "Trang: ",
    pop_diag_order: "Order nhận diện được: ",
    pop_diag_none: "không có",
    pop_diag_floor: ", tầng ",
    pop_diag_clock: "Giờ trên đồng hồ: ",
    pop_diag_cant_read: "không đọc được",
    pop_diag_special: "Order For log time: ",
    pop_diag_tracker: "Đồng hồ: ",
    pop_diag_running: "đang chạy",
    pop_diag_stopped: "đang dừng",
    pop_diag_no_btn: "không tìm thấy nút",
    pop_diag_btns: "Nút Start: {start}  Pause: {pause}  Finish: {finish}",
    pop_diag_btn_count: "Số nút trên trang: ",
    pop_yes: "có",
    pop_no: "không",

    // Journal
    jrn_title: "Nhật ký log time",
    jrn_date_label: "Ngày",
    jrn_today: "(hôm nay)",
    jrn_btn_csv: "Xuất CSV",
    jrn_btn_clear: "Xóa nhật ký ngày này",
    jrn_orders_summary: "Tổng theo order",
    jrn_lead: "Đồng hồ chạy {tracked} phút, extension tính được {orders} phút làm trên các order{survey}.",
    jrn_lead_survey: " và {survey} phút survey",
    jrn_th_order: "Order",
    jrn_th_tracked: "Phút khi đồng hồ chạy",
    jrn_th_multi: "Trong đó lúc mở nhiều order",
    jrn_th_untracked: "Phút làm khi đồng hồ tắt",
    jrn_orders_empty: "Chưa có thời gian làm order trong ngày này.",
    jrn_events: "Sự kiện",
    jrn_th_time: "Giờ",
    jrn_th_type: "Loại",
    jrn_th_details: "Nội dung",
    jrn_events_empty: "Chưa có sự kiện nào trong ngày này.",
    jrn_clear_confirm: "Xóa toàn bộ sự kiện của ngày {day}? Tổng theo order vẫn được giữ.",
    jrn_csv_date: "Ngày",
    jrn_csv_tracked: "Đồng hồ chạy (phút)",
    jrn_csv_survey: "Survey (phút)",
    jrn_btn_options: "Setting",
    jrn_th_start: "Start time",
    jrn_th_end: "End time",
    jrn_th_duration: "Time",
    jrn_pause: "Pause",
    jrn_survey: "Survey",
    jrn_none: "Không làm order",
    jrn_tl_lead: "Làm order {order}, Survey {survey}, Pause {pause}{none}.",
    jrn_tl_lead_none: ", đồng hồ chạy mà không làm order {none}",
    jrn_tl_empty: "Chưa có dữ liệu trong ngày này (bắt đầu ghi từ khi cập nhật bản extension này).",
    jrn_more: "Tổng theo order, cảnh báo và sự kiện khác",
    jrn_running: "Đồng hồ chạy",
    jrn_ongoing: "đang diễn ra",
    jrn_timeline_title: "Dòng thời gian",
    jrn_tour_summary_title: "Tổng kết theo tour",
    jrn_th_tour: "Tour",
    jrn_th_intervals: "Các khoảng thời gian thực hiện",
    jrn_tours_empty: "Chưa có tour nào trong ngày này.",
    jrn_no_intervals: "Chưa có khoảng thời gian chi tiết",
    jrn_tour_total: "Tổng",

    // Content Script
    cnt_stale: "Extension vừa cập nhật. Hãy tải lại trang (F5).",
    cnt_hide_notify: "Ẩn thông báo",
    cnt_pause_word: "tạm dừng",
    cnt_finish_word: "kết thúc",
    cnt_btn_start_survey: "Bắt đầu làm survey",
    cnt_btn_close: "Đã hiểu",
    cnt_btn_still_working: "Tôi vẫn đang làm",
    cnt_no_order_title: "Bạn chưa làm order nào",
    cnt_no_order_msg: "Đồng hồ chạy {min} phút chưa có order/survey. Hãy mở order hoặc bật survey.",
    cnt_idle_title: "Bạn còn làm việc không?",
    cnt_idle_msg: "Không thao tác trong {min} phút khi đồng hồ đang chạy.",
    cnt_after_sec: "giây nữa đồng hồ sẽ tự {word}.",
    cnt_stopping: "Đang dừng đồng hồ…",
    cnt_card_aria: "Thời gian làm order hôm nay",
    cnt_card_unidentified: "Chưa xác định được order",
    cnt_close: "Đóng",
    cnt_card_hint: "Chỉ log số phút của hôm nay, không cộng ngày trước.",
    cnt_card_special: "Order For Log Time: chỉ bấm Just log time, không unassign, ghi tên drafter vào Comment.",
    cnt_card_guessed: "Lấy theo tab làm gần nhất. Hãy kiểm tra lại mã order.",
    cnt_card_multi_now: "Đang mở nhiều order ({orders}). Hãy đóng bớt; {pending} phút chung sẽ cộng cho order giữ lại.",
    cnt_card_multi_prev: "Đã gồm {min} phút lúc mở nhiều order.",
    cnt_card_untracked: "Có {min} phút làm khi đồng hồ tắt (không tính).",
    cnt_card_reopen: "Hãy mở trang của order rồi bấm lại để xem số phút.",
    cnt_card_total: "Đồng hồ đã chạy hôm nay: {min} phút{emp}{sched}",
    cnt_card_total_emp: " (đồng hồ Emplanner đang hiện {min} phút)",
    cnt_card_total_sched: ". Schedule đã lưu trước khi Time Guard bắt đầu ghi hôm nay: {min} phút",
    cnt_card_sum: "Tổng hôm nay",
    cnt_card_now: "nay",
    cnt_card_no_segs: "Chưa có khoảng giờ nào hôm nay.",
    cnt_card_before_segs: "Gồm {min} phút làm trước khi Time Guard bắt đầu ghi khoảng giờ.",
    cnt_card_since: "Cần log hôm nay (từ {at})",
    cnt_card_unlogged: "Chưa log {min} phút của ngày {day}: cần report",
    cnt_card_logged: "Đã log lúc {at}{min}. Bảng chỉ tính thời gian sau lần log đó.",
    cnt_card_logged_min: " ({min} phút)",
    cnt_card_day: "Ngày",
    cnt_card_log_row: "Đã log {min} phút lúc {at}",
    cnt_card_log_row_nomin: "Đã log lúc {at}",
    cnt_card_need: "Cần log hôm nay",
    cnt_card_past_logged: "Đã log ngày {day}: {min} phút",
    cnt_panel_daybase: "Đã trừ {time} của ngày trước (chưa Finish).",
    cnt_panel_bar_title: "Kéo để di chuyển, nhấp đúp để thu nhỏ",
    cnt_panel_journal: "Nhật ký theo tour",
    cnt_jside_title: "Nhật ký theo tour (hôm nay)",
    cnt_jside_full: "Mở trang nhật ký đầy đủ",
    cnt_jside_close: "Đóng nhật ký",
    cnt_panel_journal_failed: "Không mở được nhật ký",
    cnt_panel_journal_err: "Không mở được nhật ký: extension không phản hồi",
    cnt_panel_min_btn: "Thu nhỏ / Mở rộng",
    cnt_panel_stale_err: "Quá 75 giây chưa bấm được, hãy kiểm tra trang Work",
    cnt_panel_err_toggle: "Không bấm được đồng hồ: {err}.",
    cnt_panel_cant_read: "Chưa đọc được đồng hồ",
    cnt_panel_finished: "Đã Finish",
    cnt_panel_f5_pinned: "hãy tải lại (F5) tab ghim",
    cnt_panel_f5_page: "hãy tải lại trang (F5)",
    cnt_panel_clicking: "Đang bấm…",
    cnt_panel_for_log_time: "Order For Log Time: ghi tên drafter vào Comment, không unassign",
    cnt_panel_worked_today: "Hôm nay đã làm:",
    cnt_panel_no_segs: "chưa có khoảng nào",
    cnt_panel_now: "nay",
    cnt_panel_end_survey: "Kết thúc survey",
    cnt_panel_start_survey: "Làm survey",
    cnt_panel_running: "Đang chạy",
    cnt_panel_paused: "Tạm dừng",
    cnt_panel_tip_pause: "Bấm để tạm dừng đồng hồ",
    cnt_panel_tip_start: "Bấm để bật đồng hồ",
    cnt_panel_click_failed: "Không bấm được",
    cnt_panel_expand: "Mở rộng bảng",
    cnt_panel_minimize: "Thu nhỏ bảng",
    cnt_panel_no_order: "Chưa mở order",
    cnt_panel_survey_note: "Đang survey: không tính giờ vào order.",
    cnt_panel_multi_note: "Mở nhiều order: {min} phút chờ gộp.",
    cnt_panel_loading_note: "Đang đọc đồng hồ… Nếu lâu, hãy kiểm tra đăng nhập Emplanner.",
    cnt_panel_end_survey_left: "Kết thúc survey (còn {min} phút)",
    cnt_panel_order_time: "Thời gian làm order này",

    // Background notifications & banners
    bg_multi_title: "Đang mở nhiều order",
    bg_multi_msg: "Đang mở {count} order ({orders}). Hãy đóng bớt, chỉ giữ 1 order (giờ lúc này tính cho order giữ lại).",
    bg_survey_banner: "Đang làm survey (tối đa {max} phút): không tính giờ vào tour. Xong hãy bấm Kết thúc survey.",
    bg_survey_end_title: "Hết giờ survey",
    bg_survey_end_msg: "Survey đã tự tắt sau {max} phút.",
    bg_idle_title: "Bạn còn làm việc không?",
    bg_idle_msg: "Không thao tác {min} phút. Tự {word} sau {sec} giây nếu không phản hồi.",
    bg_noorder_title: "Bạn chưa làm order nào",
    bg_noorder_msg: "Đồng hồ chạy {min} phút chưa có order/survey. Hãy mở order hoặc bật survey (tự {word} sau {grace}).",
    bg_mismatch_title: "Đồng hồ bị bấm ở nơi khác",
    bg_mismatch_msg: "Lệch đồng hồ (Emplanner {emp}, Time Guard {tg}). Đã đồng bộ theo Emplanner.",
    bg_autostop_title: "Đã {word} đồng hồ",
    bg_autostop_msg: "Đồng hồ đã tự {word} ({why}). Bấm ▶ Start khi làm tiếp.",
    bg_autostop_fail_title: "Cần dừng đồng hồ thủ công",
    bg_autostop_fail_msg: "Không tự {word} được đồng hồ ({why}). Hãy mở Emplanner {word} thủ công.",
    bg_surveyfp_title: "Đang trong thời gian survey",
    bg_surveyfp_msg: "Đang bật survey: thời gian trên #{id} vẫn tính là survey. Bấm Kết thúc survey nếu làm tour.",
    bg_clock_off_title: "Đồng hồ chưa bật",
    bg_surveyoff_msg: "Đang làm survey nhưng đồng hồ tắt. Hãy bấm ▶ Start.",
    bg_untracked_msg: "Đang làm order #{id} nhưng đồng hồ tắt. Hãy bấm ▶ Start.",
    bg_keepwork_msg: "Chưa đọc được đồng hồ. Nếu kéo dài, hãy đăng nhập lại Emplanner."
  },
  en: {
    // Options
    opt_page_title: "Time Guard Settings",
    opt_reset: "Restore defaults",
    opt_save: "Save settings",
    opt_general_legend: "General settings",
    opt_lang_label: "Language",
    opt_lang_vi: "Tiếng Việt",
    opt_lang_en: "English",
    opt_emp_legend: "Emplanner",
    opt_work_url: "Time tracker page",
    opt_schedule_url: "Schedule page (reads saved tracked time)",
    opt_order_legend: "Order identification",
    opt_order_patterns: "Fallback URL patterns to extract order ID, one per line",
    opt_order_patterns_hint: "The extension reads the order number from the FP Editor title and the order page first. These patterns are only used as fallback. The first capture group ( ) is the order ID.",
    opt_test_url: "Test with a URL",
    opt_test_url_ph: "Paste order page URL here",
    opt_extra_sites: "Other tour websites (besides Emplanner), one per line",
    opt_extra_sites_ph: "https://*.domain.com/*",
    opt_extra_sites_hint: "When saving, the browser will request permission to access these sites.",
    opt_timing_legend: "Timing",
    opt_idle_sec: "Inactivity warning threshold (seconds)",
    opt_grace_sec: "Grace period before auto-stop (seconds)",
    opt_untracked_sec: "Reminder threshold when working with clock off (seconds)",
    opt_active_window_sec: "Keep active after last interaction for (seconds)",
    opt_no_order_sec: "Clock running without order/survey warning threshold (seconds)",
    opt_no_order_grace_sec: "Grace period after no-order warning before auto-stop (seconds)",
    opt_survey_max_min: "Survey mode auto turn-off (minutes)",
    opt_stop_action: "When trainee does not respond",
    opt_stop_action_pause: "Pause tracker (Pause)",
    opt_stop_action_finish: "Finish tracker (Finish)",
    opt_buttons_legend: "Emplanner buttons",
    opt_buttons_hint: "Button display text, separated by commas. If a button only has an icon, enter a CSS selector. Use the 'Check this page' button in the popup to inspect detected buttons.",
    opt_l_start: "Start button labels",
    opt_s_start: "Start button CSS selector",
    opt_l_pause: "Pause button labels",
    opt_s_pause: "Pause button CSS selector",
    opt_l_finish: "Finish button labels",
    opt_s_finish: "Finish button CSS selector",
    opt_s_widget: "Clock widget CSS selector",
    opt_s_widget_hint: "If this widget exists without a Pause button, the clock is considered stopped.",
    opt_l_finish_confirm: "Finish confirmation button labels",
    opt_l_just_log: "Just log time button labels",
    opt_pattern_err: "Invalid pattern: ",
    opt_order_id: "Order ID: #",
    opt_no_order_id: "Could not extract order ID from this URL.",
    opt_extra_sites_err: "Other tour sites must be in format https://*.domain.com/* : ",
    opt_perm_err: "Permissions for other tour sites were not granted, settings not saved.",
    opt_saved: "Settings saved successfully.",
    opt_reset_done: "Default values restored. Click Save settings to apply.",

    // Popup
    pop_title: "Time Guard",
    pop_loading: "Loading…",
    pop_running: "Clock is running",
    pop_stopped: "Clock is paused",
    pop_finished: "Clock is finished (Finish)",
    pop_unknown: "Cannot read clock",
    pop_tracked_note: "Loading hidden Work page to read clock. If slow, check your Emplanner login.",
    pop_btn_start: "▶ Start tracker",
    pop_btn_pause: "⏸ Pause tracker",
    pop_btn_clicking: "Clicking on Emplanner…",
    pop_err_toggle: "Could not toggle clock: {err}. Please toggle manually on the Work page.",
    pop_btn_survey_start: "Start survey",
    pop_btn_survey_end: "End survey",
    pop_survey_active: "Survey mode: {min} min (auto-off in {left} min). Not counted towards orders.",
    pop_survey_done: "Completed {min} min of survey today.",
    pop_survey_idle: "Use when doing surveys/quizzes outside Emplanner to avoid alerts.",
    pop_today_orders: "Today's time by order",
    pop_orders_empty: "No time logged yet. Open an order and start tracker to begin.",
    pop_tag_working: "working",
    pop_tag_multi: "incl. {min} min multi-order",
    pop_tag_untracked: "{min} min clock off",
    pop_unit_min: "min",
    pop_btn_journal: "Open journal",
    pop_btn_check: "Check this page",
    pop_btn_options: "Setting",
    pop_btn_copy_diag: "Copy diagnostic results",
    pop_btn_copied: "Copied",
    pop_alert_no_order: "Clock is running without an active order/survey. Will auto-pause soon.",
    pop_alert_idle: "Inactivity warning. Move mouse on Emplanner to continue.",
    pop_alert_multi: "{count} orders open ({orders}). Please keep only 1 order open.",
    pop_diag_not_running: "Extension is not running on this page (not Emplanner or not in Settings). If just installed, reload the page (F5).",
    pop_diag_page: "Page: ",
    pop_diag_order: "Detected order: ",
    pop_diag_none: "none",
    pop_diag_floor: ", floor ",
    pop_diag_clock: "Clock time: ",
    pop_diag_cant_read: "cannot read",
    pop_diag_special: "For Log Time order: ",
    pop_diag_tracker: "Tracker: ",
    pop_diag_running: "running",
    pop_diag_stopped: "stopped",
    pop_diag_no_btn: "button not found",
    pop_diag_btns: "Start button: {start}  Pause: {pause}  Finish: {finish}",
    pop_diag_btn_count: "Button count on page: ",
    pop_yes: "yes",
    pop_no: "no",

    // Journal
    jrn_title: "Log time journal",
    jrn_date_label: "Date",
    jrn_today: "(today)",
    jrn_btn_csv: "Export CSV",
    jrn_btn_clear: "Clear this day's journal",
    jrn_orders_summary: "Summary by order",
    jrn_lead: "Clock ran for {tracked} min; extension tracked {orders} min on orders{survey}.",
    jrn_lead_survey: " and {survey} min on survey",
    jrn_th_order: "Order",
    jrn_th_tracked: "Clock running (min)",
    jrn_th_multi: "Of which multi-order (min)",
    jrn_th_untracked: "Clock off (min)",
    jrn_orders_empty: "No order time recorded for this day.",
    jrn_events: "Events",
    jrn_th_time: "Time",
    jrn_th_type: "Type",
    jrn_th_details: "Details",
    jrn_events_empty: "No events recorded for this day.",
    jrn_clear_confirm: "Delete all events for {day}? Summary by order will be preserved.",
    jrn_csv_date: "Date",
    jrn_csv_tracked: "Clock running (min)",
    jrn_csv_survey: "Survey (min)",
    jrn_btn_options: "Setting",
    jrn_th_start: "Start time",
    jrn_th_end: "End time",
    jrn_th_duration: "Time",
    jrn_pause: "Pause",
    jrn_survey: "Survey",
    jrn_none: "No order",
    jrn_tl_lead: "Orders {order}, Survey {survey}, Pause {pause}{none}.",
    jrn_tl_lead_none: ", clock running without an order {none}",
    jrn_tl_empty: "No data for this day yet (recording starts from this extension version).",
    jrn_more: "Summary by order, warnings and other events",
    jrn_running: "Clock running",
    jrn_ongoing: "ongoing",
    jrn_timeline_title: "Timeline",
    jrn_tour_summary_title: "Summary by tour",
    jrn_th_tour: "Tour",
    jrn_th_intervals: "Execution intervals",
    jrn_tours_empty: "No tours recorded for this day.",
    jrn_no_intervals: "No detailed intervals recorded",
    jrn_tour_total: "Total",

    // Content Script
    cnt_stale: "Extension updated. Please reload this page (F5).",
    cnt_hide_notify: "Hide notification",
    cnt_pause_word: "pause",
    cnt_finish_word: "finish",
    cnt_btn_start_survey: "Start survey",
    cnt_btn_close: "Got it",
    cnt_btn_still_working: "I'm still working",
    cnt_no_order_title: "No active order",
    cnt_no_order_msg: "Clock ran for {min} min without an order or survey. Open an order or start survey.",
    cnt_idle_title: "Still working?",
    cnt_idle_msg: "No activity for {min} min while clock is running.",
    cnt_after_sec: "seconds until clock will auto-{word}.",
    cnt_stopping: "Stopping clock…",
    cnt_card_aria: "Today's order time",
    cnt_card_unidentified: "Unidentified order",
    cnt_close: "Close",
    cnt_card_hint: "Only log today's minutes, do not add previous days.",
    cnt_card_special: "For Log Time order: click Just log time only, do not unassign, write drafter's name in Comment.",
    cnt_card_guessed: "Taken from recent tab. Please verify order ID.",
    cnt_card_multi_now: "Multiple orders open ({orders}). Close unused ones; {pending} min will credit to the kept order.",
    cnt_card_multi_prev: "Includes {min} min from multi-order.",
    cnt_card_untracked: "{min} min worked with clock off (not counted).",
    cnt_card_reopen: "Please open this order's page and click again to view minutes.",
    cnt_card_total: "Tracker ran today: {min} min{emp}{sched}",
    cnt_card_total_emp: " (Emplanner clock shows {min} min)",
    cnt_card_total_sched: ". Schedule saved before Time Guard started today: {min} min",
    cnt_card_sum: "Total today",
    cnt_card_now: "now",
    cnt_card_no_segs: "No time ranges recorded today.",
    cnt_card_before_segs: "Includes {min} min worked before Time Guard started recording time ranges.",
    cnt_card_since: "To log today (since {at})",
    cnt_card_unlogged: "{min} min on {day} not logged: needs report",
    cnt_card_logged: "Logged at {at}{min}. The table only counts time after that log.",
    cnt_card_logged_min: " ({min} min)",
    cnt_card_day: "Day",
    cnt_card_log_row: "Logged {min} min at {at}",
    cnt_card_log_row_nomin: "Logged at {at}",
    cnt_card_need: "To log today",
    cnt_card_past_logged: "Logged on {day}: {min} min",
    cnt_panel_daybase: "Excluded {time} from previous day (not finished).",
    cnt_panel_bar_title: "Drag to move, double-click to minimize",
    cnt_panel_journal: "Journal by tour",
    cnt_jside_title: "Journal by tour (today)",
    cnt_jside_full: "Open full journal",
    cnt_jside_close: "Close journal",
    cnt_panel_journal_failed: "Journal failed",
    cnt_panel_journal_err: "Could not open journal: extension did not respond",
    cnt_panel_min_btn: "Minimize / Expand",
    cnt_panel_stale_err: "Timed out (75s), please check the Work page",
    cnt_panel_err_toggle: "Could not toggle clock: {err}.",
    cnt_panel_cant_read: "Cannot read clock",
    cnt_panel_finished: "Finished",
    cnt_panel_f5_pinned: "please reload (F5) the pinned tab",
    cnt_panel_f5_page: "please reload the page (F5)",
    cnt_panel_clicking: "Clicking…",
    cnt_panel_for_log_time: "For Log Time order: write drafter's name in Comment, do not unassign",
    cnt_panel_worked_today: "Worked today:",
    cnt_panel_no_segs: "no time ranges yet",
    cnt_panel_now: "now",
    cnt_panel_end_survey: "End survey",
    cnt_panel_start_survey: "Survey",
    cnt_panel_running: "Running",
    cnt_panel_paused: "Paused",
    cnt_panel_tip_pause: "Click to pause clock",
    cnt_panel_tip_start: "Click to start clock",
    cnt_panel_click_failed: "Click failed",
    cnt_panel_expand: "Expand panel",
    cnt_panel_minimize: "Minimize panel",
    cnt_panel_no_order: "No active order",
    cnt_panel_survey_note: "Survey mode: time not counted to orders.",
    cnt_panel_multi_note: "Multi-order: {min} min pending.",
    cnt_panel_loading_note: "Reading clock… If slow, check Emplanner login.",
    cnt_panel_end_survey_left: "End survey ({min} min left)",
    cnt_panel_order_time: "Time on this order",

    // Background notifications & banners
    bg_multi_title: "Multiple orders open",
    bg_multi_msg: "{count} orders open ({orders}). Keep only 1 order open (time goes to the kept order).",
    bg_survey_banner: "Survey mode (max {max} min): time not counted to orders. Click End survey when done.",
    bg_survey_end_title: "Survey ended",
    bg_survey_end_msg: "Survey auto-turned off after {max} min.",
    bg_idle_title: "Still working?",
    bg_idle_msg: "No activity for {min} min. Auto-{word} in {sec}s without response.",
    bg_noorder_title: "No active order",
    bg_noorder_msg: "Clock ran {min} min without order/survey. Open an order or start survey (auto-{word} in {grace}).",
    bg_mismatch_title: "Tracker toggled elsewhere",
    bg_mismatch_msg: "Clock mismatch (Emplanner {emp}, Time Guard {tg}). Synced to Emplanner.",
    bg_autostop_title: "Clock auto-{past}",
    bg_autostop_msg: "Clock auto-{past} ({why}). Click ▶ Start to resume.",
    bg_autostop_fail_title: "Manual stop required",
    bg_autostop_fail_msg: "Could not auto-{word} clock ({why}). Please {word} manually on Emplanner.",
    bg_surveyfp_title: "Survey mode active",
    bg_surveyfp_msg: "Survey is on: time on #{id} counts as survey. Click End survey to work on orders.",
    bg_clock_off_title: "Clock is off",
    bg_surveyoff_msg: "Survey mode is on but clock is off. Click ▶ Start.",
    bg_untracked_msg: "Working on order #{id} with clock off. Click ▶ Start.",
    bg_keepwork_msg: "Cannot read clock yet. If this persists, re-login to Emplanner."
  }
};

function tgI18n(key, lang, params) {
  lang = (lang && TG_I18N[lang]) ? lang : "vi";
  const dict = TG_I18N[lang] || TG_I18N.vi;
  let str = dict[key] != null ? dict[key] : (TG_I18N.vi[key] != null ? TG_I18N.vi[key] : key);
  if (params && typeof params === "object") {
    for (const p of Object.keys(params)) {
      str = str.replace(new RegExp("{" + p + "}", "g"), params[p]);
    }
  }
  return str;
}

function tgApplyI18n(root, lang) {
  root = root || (typeof document !== "undefined" ? document : null);
  if (!root) return;
  lang = (lang && TG_I18N[lang]) ? lang : "vi";
  if (root.documentElement) root.documentElement.lang = lang;
  else if (root.ownerDocument && root.ownerDocument.documentElement) root.ownerDocument.documentElement.lang = lang;

  root.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const val = tgI18n(key, lang);
    if (val != null) el.textContent = val;
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    const val = tgI18n(key, lang);
    if (val != null) el.setAttribute("placeholder", val);
  });
  root.querySelectorAll("[data-i18n-title]").forEach(el => {
    const key = el.getAttribute("data-i18n-title");
    const val = tgI18n(key, lang);
    if (val != null) el.setAttribute("title", val);
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
    const key = el.getAttribute("data-i18n-aria-label");
    const val = tgI18n(key, lang);
    if (val != null) el.setAttribute("aria-label", val);
  });
}

var TG_EVENT_LEVEL = {
  tracker_on: "ok", survey_start: "ok", survey_fp: "warn", survey_untracked: "warn", schedule_check_failed: "danger", idle_warning: "warn", noorder_warning: "warn", untracked_work: "warn", multi_order: "warn",
  auto_stop: "warn", auto_stop_failed: "danger", tracker_mismatch: "danger", log_time: "ok", day_carry: "warn"
};

function tgMerge(s) {
  s = s || {};
  return Object.assign({}, TG_DEFAULTS, s, {
    labels: Object.assign({}, TG_DEFAULTS.labels, s.labels || {}),
    selectors: Object.assign({}, TG_DEFAULTS.selectors, s.selectors || {})
  });
}

async function tgGetSettings() {
  const r = await chrome.storage.local.get("settings");
  return tgMerge(r.settings);
}

function tgOrderId(url, settings) {
  if (!url) return null;
  for (const p of (settings || TG_DEFAULTS).orderUrlPatterns || []) {
    try {
      const m = new RegExp(p, "i").exec(url);
      if (m && m[1]) return m[1];
    } catch (e) { /* regex sai thì bỏ qua */ }
  }
  return null;
}

function tgDayKey(ts) {
  const d = new Date(ts == null ? Date.now() : ts);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function tgMin(sec) { return Math.round((sec || 0) / 60); }

// Dòng thời gian đã chuẩn hoá (dùng chung cho trang nhật ký và bảng nhật ký cạnh bảng nổi):
// khoảng No order (k: "none") < 2 phút mà ngay sau là một order thì tính cho order đó (lùi mốc bắt đầu order);
// các khoảng cùng loại liền nhau (cách <= 1 giây) thì nối. Không sửa mảng gốc.
function tgNormalizeTimeline(raw) {
  const src = (raw || []).filter(r => r && r.to > r.from).map(r => ({ ...r }));
  const list = [];
  for (let i = 0; i < src.length; i++) {
    const cur = src[i], next = src[i + 1];
    if (cur.k === "none" && next && next.k === "order" && (cur.to - cur.from) < 120000 && (next.from - cur.to) <= 60000) {
      next.from = cur.from;
      continue;
    }
    const prev = list[list.length - 1];
    if (prev && prev.k === cur.k && prev.id === cur.id && cur.from - prev.to <= 1000) prev.to = Math.max(prev.to, cur.to);
    else list.push(cur);
  }
  return list;
}

// Tổng kết theo tour của một ngày. rec = { orders, timeline } (S của hôm nay hoặc days[ngày]).
// Trả về [{ id, sec, totalMs, min, multiMin, untrackedMin, intervals: [{ from, to }] }], tour bắt đầu sớm đứng trước.
function tgTourSummary(rec) {
  rec = rec || {};
  const orders = rec.orders || {};
  const tl = tgNormalizeTimeline(rec.timeline);
  const ids = new Set(Object.keys(orders));
  tl.forEach(r => { if (r.k === "order" && r.id) ids.add(r.id); });
  const result = [];
  for (const id of ids) {
    const o = orders[id] || {};
    let segs = tl.filter(r => r.k === "order" && r.id === id).map(r => ({ from: r.from, to: r.to }));
    if (!segs.length && Array.isArray(o.segs)) segs = o.segs.filter(x => x && x.to > x.from).map(x => ({ from: x.from, to: x.to }));
    segs.sort((a, b) => a.from - b.from);
    const merged = [];  // ghép khoảng trùng nhau (nếu có)
    for (const seg of segs) {
      const prev = merged[merged.length - 1];
      if (prev && seg.from < prev.to) { if (seg.to > prev.to) prev.to = seg.to; }
      else merged.push({ from: seg.from, to: seg.to });
    }
    const intervalMs = merged.reduce((sum, iv) => sum + (iv.to - iv.from), 0);
    const baseSec = o.sec != null && o.sec > 0 ? o.sec : Math.round(intervalMs / 1000);
    const totalMs = Math.max(baseSec * 1000, intervalMs);
    const totalSec = Math.round(totalMs / 1000);
    result.push({ id, sec: totalSec, totalMs, min: tgMin(totalSec), multiMin: tgMin(o.multiSec || 0), untrackedMin: tgMin(o.untrackedSec || 0), intervals: merged });
  }
  return result.sort((a, b) => {
    const tA = a.intervals.length ? a.intervals[0].from : Infinity;
    const tB = b.intervals.length ? b.intervals[0].from : Infinity;
    return tA !== tB ? tA - tB : b.sec - a.sec;
  });
}

// "08h 00m" / "8h" / "45m" -> số phút
function tgHm(t) {
  const m = /(\d+)\s*h(?:\s*(\d+)\s*m)?|(\d+)\s*m/i.exec(String(t || ""));
  if (!m) return null;
  return m[3] != null ? +m[3] : (+m[1]) * 60 + (+(m[2] || 0));
}

function tgNorm(t) {
  return String(t || "").replace(/[▶►⏵⏸⏹■●]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function tgEsc(t) {
  return String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Chuyển match pattern của Chrome (https://*.abc.com/*) thành RegExp
function tgPatternToRegex(p) {
  const m = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(String(p || "").trim());
  if (!m) return null;
  const esc = s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const scheme = m[1] === "*" ? "https?" : m[1];
  let host = m[2];
  host = host === "*" ? "[^/]+" : host.startsWith("*.") ? "(?:[^/]+\\.)?" + esc(host.slice(2)) : esc(host);
  const path = esc(m[3]).replace(/\*/g, ".*");
  return new RegExp("^" + scheme + "://" + host + path + "$", "i");
}
