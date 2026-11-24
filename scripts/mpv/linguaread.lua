-- LinguaRead native integration for mpv and mpv.net (European languages v1)
--
-- Deliberate import contract:
--   Opening files, switching subtitle tracks (sid / secondary-sid / track-list),
--   or changing display settings never auto-imports anything. Only explicitly
--   confirming [Start & Sync Episode to Library] (or [Re-Sync Study Track to Library])
--   inside the Ctrl+l menu posts to POST /api/mpv/session.

local mp = require("mp")
local msg = require("mp.msg")
local utils = require("mp.utils")
local options = require("mp.options")

local unpack_fn = table.unpack or unpack
local is_windows = package.config:sub(1, 1) == "\\"

math.randomseed(os.time())

local opts = {
  api_url = "http://localhost:5000",
  api_token = "",
  allow_insecure_tls = false,
  curl_path = "",
  ffmpeg_path = "",
  font_name = "Segoe UI",
  font_size = 44,
  ref_font_size = 32,
  margin_bottom = 34,
  subtitle_box = "none",
  hide_osc_during_session = true,
  hover_tooltip = true,
  default_ref_mode = "peek",
  pause_on_hover = false,
  pause_on_click = "auto",
  sync_interval_seconds = 60,
  max_line_width_ratio = 0.84,
}
options.read_options(opts, "linguaread")

local function trim(s)
  if type(s) ~= "string" then return "" end
  return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function normalize_base_url(url)
  local cleaned = trim(url):gsub("/+$", ""):gsub("/api$", "")
  if cleaned == "" then return "http://localhost:5000" end
  return cleaned
end

local function resolve_curl_path()
  local custom = trim(opts.curl_path)
  if custom ~= "" then return custom end
  return is_windows and "curl.exe" or "curl"
end

local function resolve_ffmpeg_path()
  local custom = trim(opts.ffmpeg_path)
  if custom ~= "" then return custom end
  return is_windows and "ffmpeg.exe" or "ffmpeg"
end

local BITMAP_SUB_CODECS = {
  hdmv_pgs_subtitle = true,
  dvd_subtitle = true,
  dvb_subtitle = true,
  xsub = true,
  pgs = true,
  vobsub = true,
}

-- ISO 639-2/3 -> LinguaRead 2-letter language codes for visual menu default pre-selection.
local ISO3_TO_ISO2 = {
  fre = "fr", fra = "fr",
  ger = "de", deu = "de",
  spa = "es",
  dut = "nl", nld = "nl",
  pol = "pl",
  cze = "cs", ces = "cs",
  gre = "el", ell = "el",
  rum = "ro", ron = "ro",
  slo = "sk", slk = "sk",
  rus = "ru",
  ukr = "uk",
  ita = "it",
  por = "pt",
  swe = "sv",
  nor = "no", nob = "nb", nno = "nn",
  dan = "da",
  fin = "fi",
  hun = "hu",
  bul = "bg",
  hrv = "hr",
  srp = "sr",
  cat = "ca",
  tur = "tr",
  slv = "sl",
  lit = "lt",
  lav = "lv",
  est = "et",
  isl = "is", ice = "is",
  sqi = "sq", alb = "sq",
  gle = "ga",
  eus = "eu", baq = "eu",
  glg = "gl",
  mlt = "mt",
  cym = "cy", wel = "cy",
  afr = "af",
  bos = "bs",
  mkd = "mk", mac = "mk",
  bel = "be",
  eng = "en",
}

local STATUS_COLORS_BGR = {
  [0] = "FFE099", -- unknown: bright sky blue
  [1] = "7788FF", -- level 1: coral red
  [2] = "55B8FF", -- level 2: amber orange
  [3] = "66EEFF", -- level 3: soft yellow
  [4] = "99EE99", -- level 4: light mint green
  [5] = "FFFFFF", -- known: crisp white
  [6] = "B4B4BE", -- ignored: muted gray
}

local state = {
  active = false,
  live_fallback = false,
  session_gen = 0,
  sync_seq = 0,
  text_id = nil,
  title = "",
  language_id = nil,
  language_code = "",
  study_revision = "",
  study_track_id = nil,
  ref_track_id = nil,
  ref_mode = (opts.default_ref_mode == "always" or opts.default_ref_mode == "hidden") and opts.default_ref_mode or "peek",
  auto_translate_override = "auto", -- "auto" | "on" | "off"

  cues = {},
  ref_cues = {},
  word_cache = {},           -- key -> { wordId, status, translation }
  manually_graded = {},      -- key -> true (protects against background auto-translate overwrite)

  languages = {},
  languages_loaded = false,
  languages_loading = false,
  server_prefs = {
    translationTargetLanguageCode = "EN",
    pauseOnWordClick = false,
    autoTranslateWords = true,
    autoTranslateOnOpen = false,
    autoTranslateWordStatus = 5,
    wordTranslationProvider = "deepl",
    defaultLanguageId = 0,
  },

  osd_w = 1280,
  osd_h = 720,
  res_x = 1920,
  res_y = 1080,

  mouse_vx = -1,
  mouse_vy = -1,
  mouse_in_window = false,
  hover_cue_idx = nil,
  hover_tok_idx = nil,
  hover_in_sub_zone = false,
  hover_button_idx = nil,

  current_cue_idx = nil,
  current_ref_key = "",
  live_sub_text = "",
  pause_at_cue_end = false,
  cue_end_paused_idx = nil,
  paused_by_script = false,
  paused_by_hover = false,
  paused_by_menu = false,

  popup = nil, -- { cue_idx, anchor_idx, start_idx, end_idx, term, status, translation, provider, sentence_translation, loading, error, buttons = {} }
  token_rects = {},
  sub_zone_rect = nil,

  menu_open = false,
  menu_loading = false,
  menu_busy = false,
  menu_error = nil,
  menu_status = nil,
  menu_confirm_resync = false,
  menu_cursor = 1,
  menu_rows = {},
  menu_draft = nil,
  menu_rect = nil,

  saved_sub_vis = nil,
  saved_sec_sub_vis = nil,
  osc_suppressed = false,

  toast_text = nil,
  toast_timer = nil,

  -- Listening / progress accounting
  is_playing = false,
  play_wall_start = nil,
  accumulated_seconds = 0,
  last_progress_pos = nil,
  last_known_pos = nil,
  sync_timer = nil,
  event_seq = 0,

  modal_keys_bound = false,
  session_keys_bound = false,
  word_hover_keys_bound = false,
  popup_keys_bound = false,
}

local overlay_main = mp.create_osd_overlay("ass-events")
local overlay_popup = mp.create_osd_overlay("ass-events")
local overlay_menu = mp.create_osd_overlay("ass-events")

-- Forward declarations for mutual calls
local render_all
local update_keybindings
local close_popup

---------------------------------------------------------------------------
-- Pure-Lua JSON encoder (handles nil-omission, UTF-8 pass-through, arrays)
---------------------------------------------------------------------------
local json = {}

local function json_escape_str(s)
  local out = s:gsub('[\\"%c]', function(c)
    if c == '"' then return '\\"'
    elseif c == '\\' then return '\\\\'
    elseif c == '\b' then return '\\b'
    elseif c == '\f' then return '\\f'
    elseif c == '\n' then return '\\n'
    elseif c == '\r' then return '\\r'
    elseif c == '\t' then return '\\t'
    else return string.format('\\u%04x', string.byte(c))
    end
  end)
  return '"' .. out .. '"'
end

local function is_array_table(t)
  if t.__is_array then return true end
  local max_idx = 0
  local count = 0
  for k, _ in pairs(t) do
    if type(k) == "number" and k >= 1 and math.floor(k) == k then
      if k > max_idx then max_idx = k end
      count = count + 1
    else
      return false
    end
  end
  return count > 0 and max_idx == count
end

function json.encode(val)
  local tv = type(val)
  if val == nil then
    return "null"
  elseif tv == "boolean" then
    return val and "true" or "false"
  elseif tv == "number" then
    if val ~= val or val == math.huge or val == -math.huge then
      return "0"
    end
    if math.floor(val) == val and math.abs(val) < 1e14 then
      return string.format("%.0f", val)
    end
    return string.format("%.6f", val):gsub("0+$", ""):gsub("%.$", "")
  elseif tv == "string" then
    return json_escape_str(val)
  elseif tv == "table" then
    if is_array_table(val) then
      local parts = {}
      for i = 1, #val do
        parts[i] = json.encode(val[i])
      end
      return "[" .. table.concat(parts, ",") .. "]"
    else
      local parts = {}
      for k, v in pairs(val) do
        if k ~= "__is_array" and v ~= nil then
          parts[#parts + 1] = json_escape_str(tostring(k)) .. ":" .. json.encode(v)
        end
      end
      return "{" .. table.concat(parts, ",") .. "}"
    end
  end
  return "null"
end

function json.empty_array()
  return { __is_array = true }
end

---------------------------------------------------------------------------
-- Pure-Lua UTF-8 & European proportional width measurement
---------------------------------------------------------------------------
local utf8x = {}

function utf8x.codepoints(s)
  local cps = {}
  if type(s) ~= "string" or s == "" then return cps end
  local i = 1
  local n = #s
  while i <= n do
    local b1 = string.byte(s, i)
    if b1 < 0x80 then
      cps[#cps + 1] = b1
      i = i + 1
    elseif b1 >= 0xC2 and b1 <= 0xDF and i + 1 <= n then
      local b2 = string.byte(s, i + 1)
      if b2 >= 0x80 and b2 <= 0xBF then
        cps[#cps + 1] = (b1 - 0xC0) * 64 + (b2 - 0x80)
        i = i + 2
      else
        cps[#cps + 1] = 0xFFFD
        i = i + 1
      end
    elseif b1 >= 0xE0 and b1 <= 0xEF and i + 2 <= n then
      local b2 = string.byte(s, i + 1)
      local b3 = string.byte(s, i + 2)
      if b2 >= 0x80 and b2 <= 0xBF and b3 >= 0x80 and b3 <= 0xBF then
        cps[#cps + 1] = (b1 - 0xE0) * 4096 + (b2 - 0x80) * 64 + (b3 - 0x80)
        i = i + 3
      else
        cps[#cps + 1] = 0xFFFD
        i = i + 1
      end
    elseif b1 >= 0xF0 and b1 <= 0xF4 and i + 3 <= n then
      local b2 = string.byte(s, i + 1)
      local b3 = string.byte(s, i + 2)
      local b4 = string.byte(s, i + 3)
      if b2 >= 0x80 and b2 <= 0xBF and b3 >= 0x80 and b3 <= 0xBF and b4 >= 0x80 and b4 <= 0xBF then
        cps[#cps + 1] = (b1 - 0xF0) * 262144 + (b2 - 0x80) * 4096 + (b3 - 0x80) * 64 + (b4 - 0x80)
        i = i + 4
      else
        cps[#cps + 1] = 0xFFFD
        i = i + 1
      end
    else
      cps[#cps + 1] = 0xFFFD
      i = i + 1
    end
  end
  return cps
end

local NARROW_CP = {
  [0x69] = true, [0x6C] = true, [0x49] = true, [0x6A] = true, [0x74] = true,
  [0x66] = true, [0x72] = true, [0x21] = true, [0x22] = true, [0x2D] = true,
  [0x7C] = true, [0x2E] = true, [0x2C] = true, [0x3A] = true, [0x3B] = true,
  [0x27] = true, [0x31] = true, [0x60] = true, [0x28] = true, [0x29] = true,
  [0x5B] = true, [0x5D] = true, [0x2F] = true, [0xA1] = true, [0xBF] = true,
  [0xB7] = true, [0x2018] = true, [0x2019] = true, [0x201C] = true, [0x201D] = true,
  [0x03B9] = true, [0x03AF] = true, [0x0399] = true, [0x0456] = true, [0x0406] = true,
}

local WIDE_CP = {
  [0x6D] = true, [0x77] = true, [0x4D] = true, [0x57] = true, [0x40] = true,
  [0x25] = true, [0x2014] = true, [0x2026] = true,
  [0x0416] = true, [0x0428] = true, [0x0429] = true, [0x042E] = true, [0x042B] = true, [0x0424] = true,
  [0x0436] = true, [0x0448] = true, [0x0449] = true, [0x044E] = true, [0x044B] = true, [0x0444] = true,
  [0x03A9] = true, [0x03C9] = true, [0x03CE] = true, [0x038F] = true,
}

local function codepoint_em_width(cp)
  if (cp >= 0x0300 and cp <= 0x036F)
     or (cp >= 0x1AB0 and cp <= 0x1AFF)
     or (cp >= 0x1DC0 and cp <= 0x1DFF)
     or (cp >= 0x20D0 and cp <= 0x20FF)
     or (cp >= 0xFE20 and cp <= 0xFE2F)
     or cp == 0x200B or cp == 0x200C or cp == 0x200D then
    return 0.0
  end
  if cp == 0x20 or cp == 0xA0 then return 0.22 end
  if NARROW_CP[cp] then return 0.23 end
  if WIDE_CP[cp] then return 0.65 end
  if (cp >= 0x41 and cp <= 0x5A)
     or (cp >= 0xC0 and cp <= 0xDE and cp ~= 0xD7)
     or (cp >= 0x0400 and cp <= 0x042F)
     or (cp >= 0x0391 and cp <= 0x03AB) then
    return 0.50
  end
  return 0.40
end

function utf8x.measure_px(s, font_size)
  local cps = utf8x.codepoints(s)
  local em = 0.0
  for i = 1, #cps do
    em = em + codepoint_em_width(cps[i])
  end
  return em * font_size
end

function utf8x.len(s)
  return #utf8x.codepoints(s)
end

function utf8x.truncate(s, max_cps)
  local cps = utf8x.codepoints(s)
  if #cps <= max_cps then return s end
  -- Approximate safe UTF-8 boundary walk
  local count = 0
  local i = 1
  local n = #s
  while i <= n and count < math.max(1, max_cps - 1) do
    local b = string.byte(s, i)
    local step = 1
    if b >= 0xF0 then step = 4
    elseif b >= 0xE0 then step = 3
    elseif b >= 0xC2 then step = 2
    end
    if i + step - 1 > n then break end
    i = i + step
    count = count + 1
  end
  return s:sub(1, i - 1) .. "…"
end

function utf8x.truncate_bytes(s, max_bytes)
  if type(s) ~= "string" or #s <= max_bytes then return s or "" end
  local i = 1
  local last_good = 0
  local n = #s
  while i <= n do
    local b = string.byte(s, i)
    local step = 1
    if b >= 0xF0 then step = 4
    elseif b >= 0xE0 then step = 3
    elseif b >= 0xC2 then step = 2
    end
    if i + step - 1 > max_bytes or i + step - 1 > n then break end
    last_good = i + step - 1
    i = i + step
  end
  return s:sub(1, last_good)
end

local function ass_escape(s)
  if type(s) ~= "string" then return "" end
  return (s:gsub("\r\n", " "):gsub("[\r\n]", " "):gsub("\\", "\\\226\128\139"):gsub("{", "\\{"):gsub("}", "\\}"))
end

---------------------------------------------------------------------------
-- Non-blocking curl HTTP client (--config temp file on Windows, stdin elsewhere)
---------------------------------------------------------------------------
local net = {
  _req_seq = 0,
  _temp_files = {},
}

local function curl_quote(s)
  return '"' .. tostring(s)
    :gsub('\\', '\\\\')
    :gsub('"', '\\"')
    :gsub('\r', '\\r')
    :gsub('\n', '\\n')
    :gsub('\t', '\\t') .. '"'
end

local function write_windows_curl_config(config_text)
  net._req_seq = net._req_seq + 1
  local filename = string.format("linguaread-curl-%d-%d-%d.cfg", os.time(), net._req_seq, math.random(100000, 999999))

  local candidates = {}
  local env_temp = trim(os.getenv("TEMP") or "")
  if env_temp ~= "" then candidates[#candidates + 1] = env_temp end
  local env_tmp = trim(os.getenv("TMP") or "")
  if env_tmp ~= "" and env_tmp ~= env_temp then candidates[#candidates + 1] = env_tmp end
  local mpv_dir = trim(mp.command_native({"expand-path", "~~/"}) or "")
  if mpv_dir ~= "" then candidates[#candidates + 1] = mpv_dir end

  for i = 1, #candidates do
    local path = utils.join_path(candidates[i], filename)
    local f = io.open(path, "wb")
    if f then
      local ok_write = f:write(config_text)
      local ok_close = f:close()
      if ok_write and ok_close ~= false then
        net._temp_files[path] = true
        return path, nil
      end
      os.remove(path)
    end
  end

  return nil, "Failed to write temporary curl config file."
end

function net.cleanup_temp_files()
  for path, _ in pairs(net._temp_files) do
    os.remove(path)
  end
  net._temp_files = {}
end

function net.request(method, path, body_tbl, options_arg, callback)
  local req_opts = options_arg or {}
  local base = normalize_base_url(opts.api_url)
  local url = base .. path
  local timeout = req_opts.timeout or 30
  local playback_only = true
  if req_opts.playback_only ~= nil then
    playback_only = req_opts.playback_only
  end

  local cfg = {
    "silent",
    "show-error",
    "compressed",
    "connect-timeout = 10",
    "max-time = " .. tostring(timeout),
    "request = " .. method,
    "url = " .. curl_quote(url),
    'header = "X-Requested-With: XMLHttpRequest"',
    'header = "Content-Type: application/json; charset=utf-8"',
    'header = "Accept: application/json"',
  }

  local token = trim(opts.api_token)
  if token ~= "" then
    cfg[#cfg + 1] = "header = " .. curl_quote("Authorization: Bearer " .. token)
  end

  if opts.allow_insecure_tls then
    cfg[#cfg + 1] = "insecure"
  end

  if body_tbl ~= nil then
    local payload = type(body_tbl) == "string" and body_tbl or json.encode(body_tbl)
    cfg[#cfg + 1] = "data-raw = " .. curl_quote(payload)
  end

  cfg[#cfg + 1] = 'write-out = "\\n__LR_HTTP_STATUS__:%{http_code}"'

  local config_text = table.concat(cfg, "\n") .. "\n"
  local temp_path = nil
  local cmd
  if is_windows then
    local write_err
    temp_path, write_err = write_windows_curl_config(config_text)
    if not temp_path then
      if callback then callback(false, nil, 0, write_err) end
      return
    end
    cmd = {
      name = "subprocess",
      args = { resolve_curl_path(), "--config", temp_path },
      capture_stdout = true,
      capture_stderr = true,
      playback_only = playback_only,
    }
  else
    -- mpv's Win32 subprocess ignores stdin_data, so stdin piping is only used on POSIX.
    cmd = {
      name = "subprocess",
      args = { resolve_curl_path(), "--config", "-" },
      stdin_data = config_text,
      capture_stdout = true,
      capture_stderr = true,
      playback_only = playback_only,
    }
  end

  local function handle_result(success, result, error_str)
    if temp_path then
      os.remove(temp_path)
      net._temp_files[temp_path] = nil
    end
    if not callback then return end
    if not success or not result then
      callback(false, nil, 0, error_str or "Failed to launch curl")
      return
    end

    local stdout = result.stdout or ""
    local stderr = trim(result.stderr or "")
    local body_part, code_str = stdout:match("^(.-)\r?\n?__LR_HTTP_STATUS__:(%d+)%s*$")
    local http_status = tonumber(code_str) or 0

    if result.status ~= 0 and http_status == 0 then
      local err_msg = stderr ~= "" and stderr or ("curl exited with status " .. tostring(result.status))
      if result.status == 60 and not opts.allow_insecure_tls then
        err_msg = "SSL certificate verification failed (curl 60). Set allow_insecure_tls=yes in linguaread.conf only if using a self-signed dev/staging cert."
      end
      callback(false, nil, 0, err_msg)
      return
    end

    local raw_body = trim(body_part or "")
    local parsed = nil
    if raw_body ~= "" then
      parsed = utils.parse_json(raw_body)
    end

    if http_status >= 200 and http_status < 300 then
      callback(true, parsed, http_status, nil)
      return
    end

    local err_msg = "HTTP " .. tostring(http_status)
    if type(parsed) == "table" and type(parsed.message) == "string" and parsed.message ~= "" then
      err_msg = parsed.message
    elseif type(parsed) == "table" and type(parsed.title) == "string" and parsed.title ~= "" then
      err_msg = parsed.title
    elseif raw_body ~= "" then
      err_msg = raw_body
    elseif stderr ~= "" then
      err_msg = stderr
    end

    if http_status == 401 then
      err_msg = "Unauthorized (401). Check api_token in linguaread.conf."
    elseif http_status == 403 and err_msg == "HTTP 403" then
      err_msg = "Forbidden (403). Check LocalMode/X-Requested-With or token scope."
    end

    callback(false, parsed, http_status, err_msg)
  end

  if req_opts.sync == true then
    local res, err = mp.command_native(cmd)
    handle_result(res ~= nil, res, err)
  else
    mp.command_native_async(cmd, handle_result)
  end
end

---------------------------------------------------------------------------
-- Subtitle extraction (Windows Unicode safe) & SRT / VTT / ASS sanitization
---------------------------------------------------------------------------
local sub = {}

local HTML_ENTITIES = {
  amp = "&",
  lt = "<",
  gt = ">",
  quot = '"',
  apos = "'",
  nbsp = " ",
  ["#39"] = "'",
  ["#x27"] = "'",
  ["#34"] = '"',
}

local function decode_entities(s)
  s = s:gsub("&([%w#]+);", function(ent)
    local lower = ent:lower()
    if HTML_ENTITIES[lower] then return HTML_ENTITIES[lower] end
    local dec = lower:match("^#(%d+)$")
    if dec then
      local n = tonumber(dec)
      if n == 38 then return "&"
      elseif n == 60 then return "<"
      elseif n == 62 then return ">"
      elseif n == 34 then return '"'
      elseif n == 39 then return "'"
      elseif n == 160 then return " "
      end
    end
    return "&" .. ent .. ";"
  end)
  return s
end

local function sanitize_dialogue_text(raw, is_ass)
  if type(raw) ~= "string" then return "" end
  local s = raw
  if is_ass then
    if s:find("\\p[1-9]") then
      return ""
    end
    s = s:gsub("{[^}]*}", "")
    s = s:gsub("\\h", " ")
    s = s:gsub("\\N", "\n"):gsub("\\n", "\n")
  else
    s = s:gsub("{[^}]*}", "")
    -- Remove VTT timestamp tags <00:00:00.000> and HTML tags <i>, <font ...>, etc.
    s = s:gsub("<[^>]+>", "")
  end
  s = decode_entities(s)
  s = s:gsub("\r\n", "\n"):gsub("\r", "\n")
  -- Clean whitespace per line while preserving deliberate line breaks
  local lines = {}
  for line in (s .. "\n"):gmatch("([^\n]*)\n") do
    local cleaned = trim(line:gsub("[ \t]+", " "))
    if cleaned ~= "" then
      lines[#lines + 1] = cleaned
    end
  end
  return table.concat(lines, "\n")
end

local function parse_ass_time(ts)
  local h, m, s, cs = trim(ts):match("^(%d+):(%d%d):(%d%d)%.(%d%d)$")
  if not h then
    h, m, s, cs = trim(ts):match("^(%d+):(%d%d):(%d%d),(%d%d)$")
  end
  if not h then return nil end
  return tonumber(h) * 3600 + tonumber(m) * 60 + tonumber(s) + tonumber(cs) / 100
end

local function parse_srt_vtt_time(ts)
  local s = trim(ts)
  local h, m, sec, ms = s:match("^(%d+):(%d%d):(%d%d)[,.](%d%d%d)")
  if h then
    return tonumber(h) * 3600 + tonumber(m) * 60 + tonumber(sec) + tonumber(ms) / 1000
  end
  local m2, sec2, ms2 = s:match("^(%d+):(%d%d)[,.](%d%d%d)")
  if m2 then
    return tonumber(m2) * 60 + tonumber(sec2) + tonumber(ms2) / 1000
  end
  return nil
end

local function is_non_dialogue_ass_style(style_name, effect_name)
  local combined = (" " .. tostring(style_name or "") .. " " .. tostring(effect_name or "") .. " ")
    :lower()
    :gsub("[^%a%d]+", " ")
  local blocked_words = {
    "sign", "signs", "typeset", "typesetting", "title", "titles",
    "logo", "logos", "karaoke", "template", "code", "fx", "op", "ed",
  }
  for i = 1, #blocked_words do
    if combined:find(" " .. blocked_words[i] .. " ", 1, true) then
      return true
    end
  end
  if combined:find(" op%d+ ") or combined:find(" ed%d+ ") then
    return true
  end
  return false
end

local function finalize_cues(raw_cues)
  table.sort(raw_cues, function(a, b)
    if a.startSeconds ~= b.startSeconds then
      return a.startSeconds < b.startSeconds
    end
    if a.endSeconds ~= b.endSeconds then
      return a.endSeconds < b.endSeconds
    end
    return a._order < b._order
  end)

  local out = {}
  for i = 1, #raw_cues do
    local cue = raw_cues[i]
    local prev = out[#out]
    if prev and prev.text == cue.text and (cue.startSeconds - prev.endSeconds) < 0.2 then
      if cue.endSeconds > prev.endSeconds then
        prev.endSeconds = cue.endSeconds
      end
    else
      out[#out + 1] = {
        startSeconds = cue.startSeconds,
        endSeconds = cue.endSeconds,
        text = cue.text,
      }
    end
  end
  return out
end

local function split_ass_format(fmt_line)
  local cols = {}
  for part in (fmt_line .. ","):gmatch("([^,]*),") do
    cols[#cols + 1] = trim(part):lower()
  end
  return cols
end

local function split_n_fields(line, num_cols)
  local fields = {}
  local start_pos = 1
  local len = #line
  for i = 1, num_cols - 1 do
    local comma = line:find(",", start_pos, true)
    if not comma then break end
    fields[i] = line:sub(start_pos, comma - 1)
    start_pos = comma + 1
  end
  if #fields == num_cols - 1 and start_pos <= len + 1 then
    fields[num_cols] = line:sub(start_pos)
  end
  return fields
end

function sub.parse_ass(content)
  local cues = {}
  local in_events = false
  local col_map = { start = 2, ["end"] = 3, style = 4, name = 5, effect = 9, text = 10 }
  local num_cols = 10
  local order = 0

  content = content:gsub("^\239\187\191", ""):gsub("\r\n", "\n"):gsub("\r", "\n")
  for line in (content .. "\n"):gmatch("([^\n]*)\n") do
    local section = line:match("^%s*%[([^%]]+)%]%s*$")
    if section then
      in_events = section:lower() == "events"
    elseif in_events then
      local fmt = line:match("^[Ff][Oo][Rr][Mm][Aa][Tt]:%s*(.+)$")
      if fmt then
        local cols = split_ass_format(fmt)
        if #cols >= 2 then
          num_cols = #cols
          col_map = {}
          for idx = 1, #cols do
            col_map[cols[idx]] = idx
          end
        end
      else
        local dial = line:match("^[Dd][Ii][Aa][Ll][Oo][Gg][Uu][Ee]:%s*(.+)$")
        if dial then
          local fields = split_n_fields(dial, num_cols)
          local start_s = parse_ass_time(fields[col_map.start or 2] or "")
          local end_s = parse_ass_time(fields[col_map["end"] or 3] or "")
          local style_val = col_map.style and fields[col_map.style] or ""
          local effect_val = col_map.effect and fields[col_map.effect] or ""
          local raw_text = col_map.text and fields[col_map.text] or ""
          if start_s and end_s and end_s >= start_s and not is_non_dialogue_ass_style(style_val, effect_val) then
            local text = sanitize_dialogue_text(raw_text, true)
            if text ~= "" then
              order = order + 1
              cues[#cues + 1] = {
                startSeconds = start_s,
                endSeconds = end_s,
                text = text,
                _order = order,
              }
            end
          end
        end
      end
    end
  end

  return finalize_cues(cues)
end

function sub.parse_srt_or_vtt(content)
  local cues = {}
  local normalized = content:gsub("^\239\187\191", ""):gsub("\r\n", "\n"):gsub("\r", "\n")
  local lines = {}
  for line in (normalized .. "\n"):gmatch("([^\n]*)\n") do
    lines[#lines + 1] = line
  end

  local order = 0
  local i = 1
  local total = #lines

  -- Skip optional WEBVTT header
  if total >= 1 and lines[1]:match("^WEBVTT") then
    i = 2
  end

  while i <= total do
    local line = lines[i]
    local trimmed_line = trim(line)

    if trimmed_line == "" then
      i = i + 1
    elseif trimmed_line:match("^NOTE%f[%s]") or trimmed_line == "NOTE"
        or trimmed_line:match("^STYLE%f[%s]") or trimmed_line == "STYLE"
        or trimmed_line:match("^REGION%f[%s]") or trimmed_line == "REGION" then
      i = i + 1
      while i <= total and trim(lines[i]) ~= "" do
        i = i + 1
      end
    elseif line:find("-->", 1, true) then
      local left_ts, right_ts = line:match("^(.-)%s*%-%->%s*(.+)$")
      local start_s = left_ts and parse_srt_vtt_time(left_ts)
      local end_s = right_ts and parse_srt_vtt_time(right_ts)
      i = i + 1
      local text_lines = {}
      while i <= total and trim(lines[i]) ~= "" do
        text_lines[#text_lines + 1] = lines[i]
        i = i + 1
      end
      if start_s and end_s and end_s >= start_s then
        local text = sanitize_dialogue_text(table.concat(text_lines, "\n"), false)
        if text ~= "" then
          order = order + 1
          cues[#cues + 1] = {
            startSeconds = start_s,
            endSeconds = end_s,
            text = text,
            _order = order,
          }
        end
      end
    else
      i = i + 1
    end
  end

  return finalize_cues(cues)
end

function sub.parse_auto(content, ext_hint)
  if type(content) ~= "string" or content == "" then return {} end
  local head = content:sub(1, 2048)
  if (ext_hint and (ext_hint == "ass" or ext_hint == "ssa"))
     or head:find("[Events]", 1, true)
     or head:find("Dialogue:", 1, true) then
    return sub.parse_ass(content)
  end
  return sub.parse_srt_or_vtt(content)
end

local function is_utf16_or_binary(data)
  if #data >= 2 then
    local b1, b2 = string.byte(data, 1, 2)
    if (b1 == 0xFF and b2 == 0xFE) or (b1 == 0xFE and b2 == 0xFF) then
      return true
    end
  end
  if data:sub(1, 256):find("\0", 1, true) then
    return true
  end
  return false
end

local function resolve_external_path(ext_path)
  if type(ext_path) ~= "string" or ext_path == "" then return "" end
  if ext_path:match("^https?://")
     or ext_path:match("^[A-Za-z]:[/\\]")
     or ext_path:match("^[/\\][/\\]")
     or ext_path:sub(1, 1) == "/" then
    return ext_path
  end
  local wd = mp.get_property("working-directory") or ""
  if wd ~= "" then
    return utils.join_path(wd, ext_path)
  end
  return ext_path
end

local function run_ffmpeg_ass(args, callback)
  mp.command_native_async({
    name = "subprocess",
    args = args,
    capture_stdout = true,
    capture_stderr = true,
    playback_only = true,
  }, function(success, result, error_str)
    if not success or not result or result.status ~= 0 then
      local err = (result and trim(result.stderr or "")) or error_str or "ffmpeg subtitle extraction failed"
      callback(false, {}, err)
      return
    end
    local stdout = result.stdout or ""
    local cues = sub.parse_ass(stdout)
    if #cues == 0 then
      callback(false, {}, "Extracted subtitle stream contained no dialogue cues.")
      return
    end
    callback(true, cues, nil)
  end)
end

function sub.extract_track(track, callback)
  if not track then
    callback(false, {}, "No subtitle track selected.")
    return
  end

  if track.external and track["external-filename"] and track["external-filename"] ~= "" then
    local resolved = resolve_external_path(track["external-filename"])
    if not resolved:match("^https?://") then
      local f = io.open(resolved, "rb")
      if f then
        local data = f:read("*a")
        f:close()
        if data and data ~= "" and not is_utf16_or_binary(data) then
          local ext = resolved:match("%.([^./\\]+)$")
          local cues = sub.parse_auto(data, ext and ext:lower() or nil)
          if #cues > 0 then
            callback(true, cues, nil)
            return
          end
        end
      end
    end

    -- Fallback for UTF-8 paths outside Windows ANSI codepage, UTF-16 BOM files, or URLs
    run_ffmpeg_ass({
      resolve_ffmpeg_path(), "-v", "error", "-i", resolved, "-f", "ass", "-",
    }, callback)
    return
  end

  local ff_index = track["ff-index"]
  if ff_index == nil then
    callback(false, {}, "Embedded subtitle track has no ff-index.")
    return
  end

  local media_path = mp.get_property("path") or ""
  if media_path == "" then
    callback(false, {}, "No active media path.")
    return
  end

  run_ffmpeg_ass({
    resolve_ffmpeg_path(), "-v", "error", "-i", media_path,
    "-map", "0:" .. tostring(ff_index), "-f", "ass", "-",
  }, callback)
end

---------------------------------------------------------------------------
-- Track & language helpers (never reactive, read only on explicit menu open)
---------------------------------------------------------------------------
local function get_text_sub_tracks()
  local raw = mp.get_property_native("track-list") or {}
  local tracks = {}
  for i = 1, #raw do
    local t = raw[i]
    if t.type == "sub" and not BITMAP_SUB_CODECS[tostring(t.codec or ""):lower()] then
      tracks[#tracks + 1] = t
    end
  end
  return tracks
end

local function format_track_label(t)
  if not t then return "None" end
  local parts = { "#" .. tostring(t.id or "?") }
  if t.lang and t.lang ~= "" then parts[#parts + 1] = "[" .. t.lang .. "]" end
  if t.title and t.title ~= "" then
    parts[#parts + 1] = utf8x.truncate(t.title, 28)
  elseif t.external then
    parts[#parts + 1] = "External"
  else
    parts[#parts + 1] = tostring(t.codec or "sub")
  end
  return table.concat(parts, " ")
end

local function map_track_lang_to_lingua_id(track_lang, languages, fallback_id)
  if type(track_lang) == "string" and track_lang ~= "" and #languages > 0 then
    local norm = trim(track_lang):lower():gsub("_", "-")
    local base = norm:match("^([^%-]+)") or norm
    local mapped2 = ISO3_TO_ISO2[base] or base
    for i = 1, #languages do
      local l = languages[i]
      local lcode = tostring(l.code or ""):lower():gsub("_", "-")
      local lbase = lcode:match("^([^%-]+)") or lcode
      if lcode == norm or lbase == mapped2 or lbase == base then
        return l.languageId
      end
    end
  end
  if fallback_id and fallback_id > 0 then
    for i = 1, #languages do
      if languages[i].languageId == fallback_id then
        return fallback_id
      end
    end
  end
  return #languages > 0 and languages[1].languageId or nil
end

local function find_language_by_id(id)
  for i = 1, #state.languages do
    if state.languages[i].languageId == id then
      return state.languages[i], i
    end
  end
  return nil, nil
end

---------------------------------------------------------------------------
-- Cue lookup & word cache helpers
---------------------------------------------------------------------------
local function find_cues_at_time(cues_list, t)
  if not t or not cues_list or #cues_list == 0 then return {} end
  local active = {}
  for i = 1, #cues_list do
    local c = cues_list[i]
    if t >= c.startSeconds and t <= c.endSeconds then
      active[#active + 1] = i
    elseif c.startSeconds > t then
      break
    end
  end
  return active
end

local function resolve_cue_token_state(tok)
  if not tok.isWord then return tok end
  local key = tok.term or ""
  if key ~= "" and state.word_cache[key] then
    local cached = state.word_cache[key]
    return {
      text = tok.text,
      term = key,
      isWord = true,
      wordId = cached.wordId or tok.wordId,
      status = cached.status ~= nil and cached.status or tok.status,
      translation = cached.translation ~= nil and cached.translation or tok.translation,
    }
  end
  return tok
end

local function build_word_cache_from_cues(cues)
  state.word_cache = {}
  for i = 1, #cues do
    local toks = cues[i].tokens or {}
    for j = 1, #toks do
      local tok = toks[j]
      if tok.isWord and tok.term and tok.term ~= "" then
        local existing = state.word_cache[tok.term]
        if not existing or ((tok.status or 0) > (existing.status or 0)) then
          state.word_cache[tok.term] = {
            wordId = tok.wordId,
            status = tok.status or 0,
            translation = tok.translation,
          }
        end
      end
    end
  end
end

---------------------------------------------------------------------------
-- Toast notifications & listening / progress sync
---------------------------------------------------------------------------
local function show_toast(text, duration)
  state.toast_text = text
  if state.toast_timer then
    state.toast_timer:kill()
    state.toast_timer = nil
  end
  if text and text ~= "" then
    state.toast_timer = mp.add_timeout(duration or 3.0, function()
      state.toast_text = nil
      state.toast_timer = nil
      render_all()
    end)
  end
  render_all()
end

local function accumulate_listening_now()
  if not state.active or not state.is_playing or not state.play_wall_start then
    return
  end
  local now = mp.get_time()
  local delta = now - state.play_wall_start
  state.play_wall_start = now
  if delta > 0 then
    -- Cap single tick at 1 hour in case system slept
    state.accumulated_seconds = state.accumulated_seconds + math.min(delta, 3600)
  end
end

local function next_client_event_id(text_id)
  state.event_seq = state.event_seq + 1
  return string.format("mpv-%d-%d-%d-%04d",
    text_id or 0,
    os.time(),
    state.event_seq,
    math.random(0, 9999))
end

local function get_episode_duration_seconds()
  local dur = mp.get_property_native("duration")
  if type(dur) == "number" and dur > 0 then
    return dur
  end
  if #state.cues > 0 then
    local last_end = state.cues[#state.cues].endSeconds
    if type(last_end) == "number" and last_end > 0 then
      return last_end
    end
  end
  return nil
end

local function flush_listening_and_progress(force_progress, sync_mode)
  if not state.active or not state.text_id or not state.language_id then
    return
  end

  local req_opts = sync_mode
    and { playback_only = false, sync = true, timeout = 3 }
    or { playback_only = false }

  accumulate_listening_now()
  local whole_seconds = math.floor(state.accumulated_seconds)
  if whole_seconds >= 1 then
    state.accumulated_seconds = state.accumulated_seconds - whole_seconds
    local body = {
      languageId = state.language_id,
      durationSeconds = whole_seconds,
      clientEventId = next_client_event_id(state.text_id),
    }
    local dur = get_episode_duration_seconds()
    if dur and dur > 0 and state.study_revision ~= "" and #state.study_revision == 64 then
      body.lesson = {
        textId = state.text_id,
        sourceRevision = state.study_revision,
        playedSeconds = whole_seconds,
        audioDurationSeconds = dur,
      }
    end
    net.request("POST", "/api/activity/logListening", body, req_opts, function(ok, _, _, err)
      if not ok then
        msg.warn("Listening sync failed: " .. tostring(err))
      end
    end)
  end

  local pos = mp.get_property_native("time-pos")
  if type(pos) ~= "number" or pos < 0 then
    pos = state.last_known_pos
  end
  if type(pos) == "number" and pos >= 0 then
    local moved = not state.last_progress_pos or math.abs(pos - state.last_progress_pos) >= 1.0
    if force_progress or moved then
      state.last_progress_pos = pos
      net.request("PUT", "/api/activity/audiolessonprogress", {
        textId = state.text_id,
        currentPosition = pos,
        clientUpdatedAt = os.date("!%Y-%m-%dT%H:%M:%SZ"),
      }, req_opts, function(ok, _, _, err)
        if not ok then
          msg.warn("Progress sync failed: " .. tostring(err))
        end
      end)
    end
  end
end

local function restore_native_subs()
  if state.saved_sub_vis ~= nil then
    mp.set_property_native("sub-visibility", state.saved_sub_vis)
    state.saved_sub_vis = nil
  end
  if state.saved_sec_sub_vis ~= nil then
    mp.set_property_native("secondary-sub-visibility", state.saved_sec_sub_vis)
    state.saved_sec_sub_vis = nil
  end
end

local function suppress_native_subs()
  if state.saved_sub_vis == nil then
    state.saved_sub_vis = mp.get_property_native("sub-visibility")
  end
  if state.saved_sec_sub_vis == nil then
    state.saved_sec_sub_vis = mp.get_property_native("secondary-sub-visibility")
  end
  mp.set_property_native("sub-visibility", false)
  mp.set_property_native("secondary-sub-visibility", false)
end

local function set_osc_suppressed(hide, force)
  if not opts.hide_osc_during_session then return end
  if hide then
    if force or not state.osc_suppressed then
      state.osc_suppressed = true
      mp.commandv("script-message", "osc-visibility", "never", "no-osd")
    end
  elseif state.osc_suppressed then
    state.osc_suppressed = false
    mp.commandv("script-message", "osc-visibility", "auto", "no-osd")
  end
end

local function reset_active_session_fields()
  if state.sync_timer then
    state.sync_timer:kill()
    state.sync_timer = nil
  end
  state.session_gen = state.session_gen + 1
  state.active = false
  state.live_fallback = false
  state.text_id = nil
  state.title = ""
  state.study_revision = ""
  state.cues = {}
  state.ref_cues = {}
  state.word_cache = {}
  state.manually_graded = {}
  state.current_cue_idx = nil
  state.current_ref_key = ""
  state.hover_cue_idx = nil
  state.hover_tok_idx = nil
  state.hover_in_sub_zone = false
  state.hover_button_idx = nil
  state.token_rects = {}
  state.sub_zone_rect = nil
  state.popup = nil
  state.pause_at_cue_end = false
  state.cue_end_paused_idx = nil
  state.is_playing = false
  state.play_wall_start = nil
  state.accumulated_seconds = 0
  state.last_progress_pos = nil
  state.last_known_pos = nil
end

local function stop_session(reason_toast)
  state.sync_seq = state.sync_seq + 1
  if state.active then
    flush_listening_and_progress(true)
  end
  reset_active_session_fields()

  if state.paused_by_script then
    mp.set_property_native("pause", false)
    state.paused_by_script = false
    state.paused_by_hover = false
  end

  restore_native_subs()
  set_osc_suppressed(false)
  update_keybindings()
  if reason_toast then
    show_toast(reason_toast, 3.0)
  else
    render_all()
  end
end

---------------------------------------------------------------------------
-- Background Auto-Translate
---------------------------------------------------------------------------
local function trigger_auto_translate(text_id, force_flag)
  if not text_id then return end
  local gen = state.session_gen
  show_toast("Auto-translating unknown words...", 4.0)
  net.request("POST", "/api/mpv/auto-translate", {
    textId = text_id,
    force = force_flag and true or false,
  }, { timeout = 90, playback_only = true }, function(ok, data, _, err)
    if state.session_gen ~= gen or not state.active or state.text_id ~= text_id then
      return
    end
    if not ok then
      show_toast("Auto-translate failed: " .. tostring(err), 4.0)
      return
    end
    if type(data) ~= "table" or data.skipped then
      return
    end
    local words = data.words or {}
    local updated = 0
    for i = 1, #words do
      local w = words[i]
      if w and w.term and not state.manually_graded[w.term] then
        state.word_cache[w.term] = {
          wordId = w.wordId,
          status = w.status,
          translation = w.translation,
        }
        updated = updated + 1
      end
    end
    if state.popup and state.popup.term and state.word_cache[state.popup.term] then
      local cached = state.word_cache[state.popup.term]
      if not state.manually_graded[state.popup.term] then
        state.popup.status = cached.status or state.popup.status
      end
      if cached.translation and cached.translation ~= "" then
        state.popup.translation = cached.translation
      end
    end
    local suffix = data.capped and " (capped at 200)" or ""
    if updated > 0 then
      show_toast(string.format("Auto-translated %d words%s", updated, suffix), 3.0)
    elseif force_flag then
      show_toast("No new words needed translation.", 2.5)
    else
      render_all()
    end
  end)
end

---------------------------------------------------------------------------
-- Word / Phrase Lookup, Sentence Translation, AI Gloss, & Safe Grading
---------------------------------------------------------------------------
local function should_pause_on_click()
  if opts.pause_on_click == "yes" or opts.pause_on_click == true then
    return true
  elseif opts.pause_on_click == "no" or opts.pause_on_click == false then
    return false
  end
  return state.server_prefs.pauseOnWordClick == true
end

local function ensure_script_pause(from_hover)
  local currently_paused = mp.get_property_native("pause")
  if not currently_paused then
    mp.set_property_native("pause", true)
    state.paused_by_script = true
    state.paused_by_hover = from_hover and true or false
  end
end

local function release_script_pause_if_owned()
  if state.paused_by_script then
    mp.set_property_native("pause", false)
    state.paused_by_script = false
    state.paused_by_hover = false
  end
end

close_popup = function()
  state.popup = nil
  state.hover_button_idx = nil
  if not state.menu_open and not (opts.pause_on_hover and state.hover_in_sub_zone) then
    release_script_pause_if_owned()
  end
  update_keybindings()
  render_all()
end

local function fetch_lookup(mode, include_sentence)
  if not state.popup or not state.language_id then return end
  local p = state.popup
  local cue = state.cues[p.cue_idx]
  local sentence_ctx = cue and cue.text:gsub("\r?\n", " ") or state.live_sub_text:gsub("\r?\n", " ")
  local gen = state.session_gen
  local target_term = p.term

  p.loading = true
  p.error = nil
  render_all()

  net.request("POST", "/api/mpv/lookup", {
    languageId = state.language_id,
    term = target_term,
    sentenceContext = sentence_ctx ~= "" and sentence_ctx or nil,
    mode = mode or "word",
    includeSentenceTranslation = include_sentence and true or false,
  }, { timeout = 30, playback_only = true }, function(ok, data, _, err)
    if state.session_gen ~= gen or not state.popup or state.popup.term ~= target_term then
      return
    end
    state.popup.loading = false
    if not ok or type(data) ~= "table" then
      state.popup.error = tostring(err or "Lookup failed")
      render_all()
      return
    end
    if type(data.translation) == "string" and data.translation ~= "" then
      state.popup.translation = data.translation
      local existing = state.word_cache[target_term] or { status = state.popup.status or 0 }
      existing.translation = data.translation
      state.word_cache[target_term] = existing
    end
    if type(data.provider) == "string" and data.provider ~= "" then
      state.popup.provider = data.provider
    end
    if type(data.sentenceTranslation) == "string" and data.sentenceTranslation ~= "" then
      state.popup.sentence_translation = data.sentenceTranslation
    end
    render_all()
  end)
end

local function open_word_popup(cue_idx, start_idx, end_idx)
  local cue = state.cues[cue_idx]
  if not cue then return end
  local toks = cue.tokens or {}
  if start_idx > end_idx then
    start_idx, end_idx = end_idx, start_idx
  end

  local term = ""
  local status = 0
  local word_id = nil
  local translation = nil
  local provider = nil

  if start_idx == end_idx then
    local resolved = resolve_cue_token_state(toks[start_idx])
    if not resolved.isWord then return end
    term = resolved.term ~= "" and resolved.term or resolved.text
    status = resolved.status or 0
    word_id = resolved.wordId
    translation = resolved.translation
    if translation and translation ~= "" then
      provider = "cached"
    end
  else
    local word_parts = {}
    for idx = start_idx, end_idx do
      local t = toks[idx]
      if t and t.isWord then
        local part = trim(t.text)
        if part ~= "" then
          word_parts[#word_parts + 1] = part
        end
      end
    end
    local joined = table.concat(word_parts, " ")
    if joined == "" then return end
    if utf8x.len(joined) > 100 or #joined > 100 then
      local truncated = trim(utf8x.truncate_bytes(joined, 100))
      local last_space = truncated:match("^(.*)%s+%S*$")
      joined = (last_space and last_space ~= "") and last_space or truncated
    end
    term = joined:lower()
    local cached = state.word_cache[term]
    if cached then
      status = cached.status or 0
      word_id = cached.wordId
      translation = cached.translation
      if translation and translation ~= "" then provider = "cached" end
    end
  end

  if should_pause_on_click() then
    ensure_script_pause(false)
  end

  state.popup = {
    cue_idx = cue_idx,
    anchor_idx = start_idx,
    start_idx = start_idx,
    end_idx = end_idx,
    term = term,
    word_id = word_id,
    status = status,
    translation = translation,
    provider = provider,
    sentence_translation = nil,
    loading = false,
    error = nil,
    buttons = {},
  }
  update_keybindings()
  render_all()

  if (not translation or translation == "") and state.server_prefs.autoTranslateWords ~= false then
    fetch_lookup("word", false)
  end
end

local function adjust_phrase_selection(delta)
  if not state.popup then return end
  local cue = state.cues[state.popup.cue_idx]
  if not cue or not cue.tokens then return end
  local toks = cue.tokens
  local s_idx = state.popup.start_idx
  local e_idx = state.popup.end_idx

  if delta > 0 then
    local next_idx = e_idx + 1
    while next_idx <= #toks and not toks[next_idx].isWord do
      next_idx = next_idx + 1
    end
    if next_idx > #toks then return end
    -- Check 100-char ceiling
    local parts = {}
    for k = s_idx, next_idx do
      if toks[k].isWord then parts[#parts + 1] = trim(toks[k].text) end
    end
    if #table.concat(parts, " ") > 100 then
      show_toast("Phrase limit is 100 characters.", 2.0)
      return
    end
    e_idx = next_idx
  else
    if e_idx <= s_idx then return end
    local prev_idx = e_idx - 1
    while prev_idx >= s_idx and not toks[prev_idx].isWord do
      prev_idx = prev_idx - 1
    end
    if prev_idx < s_idx then return end
    e_idx = prev_idx
  end

  open_word_popup(state.popup.cue_idx, s_idx, e_idx)
end

local function grade_active_word(new_status)
  local term = nil
  local cue_idx = state.current_cue_idx
  local existing_translation = nil

  if state.popup then
    term = state.popup.term
    cue_idx = state.popup.cue_idx
    existing_translation = state.popup.translation
  elseif state.hover_cue_idx and state.hover_tok_idx then
    local cue = state.cues[state.hover_cue_idx]
    local tok = cue and cue.tokens and cue.tokens[state.hover_tok_idx]
    if tok and tok.isWord then
      local resolved = resolve_cue_token_state(tok)
      term = resolved.term ~= "" and resolved.term or resolved.text
      cue_idx = state.hover_cue_idx
      existing_translation = resolved.translation
    end
  end

  if not term or term == "" or not state.text_id then return end

  local cached = state.word_cache[term]
  if (not existing_translation or existing_translation == "") and cached and cached.translation ~= "" then
    existing_translation = cached.translation
  end

  -- 0ms optimistic update
  state.manually_graded[term] = true
  state.word_cache[term] = {
    wordId = cached and cached.wordId or (state.popup and state.popup.word_id) or nil,
    status = new_status,
    translation = existing_translation,
  }
  if state.popup and state.popup.term == term then
    state.popup.status = new_status
  end
  render_all()

  local cue = cue_idx and state.cues[cue_idx]
  local sentence = cue and cue.text:gsub("\r?\n", " ") or ""

  local payload = {
    textId = state.text_id,
    term = term,
    status = new_status,
    sentence = sentence ~= "" and sentence or nil,
    replaceExisting = true,
  }
  -- CRITICAL: Omit translation unless non-empty so WordsController never deletes saved DB translations.
  if type(existing_translation) == "string" and trim(existing_translation) ~= "" then
    payload.translation = trim(existing_translation)
  end

  local gen = state.session_gen
  net.request("POST", "/api/words", payload, { playback_only = false }, function(ok, data, _, err)
    if not ok then
      show_toast("Failed to save word: " .. tostring(err), 3.5)
      return
    end
    if state.session_gen == gen and type(data) == "table" and data.wordId then
      local cur = state.word_cache[term] or {}
      cur.wordId = data.wordId
      if type(data.translation) == "string" and data.translation ~= "" then
        cur.translation = data.translation
      end
      state.word_cache[term] = cur
      if state.popup and state.popup.term == term then
        state.popup.word_id = data.wordId
      end
    end
  end)
end

local function step_word_status(delta)
  local current_status = 0
  if state.popup then
    current_status = state.popup.status or 0
  elseif state.hover_cue_idx and state.hover_tok_idx then
    local cue = state.cues[state.hover_cue_idx]
    local tok = cue and cue.tokens and cue.tokens[state.hover_tok_idx]
    if tok and tok.isWord then
      current_status = resolve_cue_token_state(tok).status or 0
    end
  else
    return
  end

  local next_status
  if current_status <= 0 or current_status == 6 then
    next_status = delta > 0 and 1 or 5
  else
    next_status = math.max(1, math.min(5, current_status + delta))
  end
  grade_active_word(next_status)
end

local function replay_current_cue()
  local idx = (state.popup and state.popup.cue_idx) or state.current_cue_idx
  local cue = idx and state.cues[idx]
  if not cue then return end
  local target = math.max(0, cue.startSeconds - 0.15)
  state.cue_end_paused_idx = nil
  mp.commandv("seek", tostring(target), "absolute", "exact")
  mp.set_property_native("pause", false)
  state.paused_by_script = false
  state.paused_by_hover = false
end

local function cycle_ref_mode()
  if state.ref_mode == "peek" then
    state.ref_mode = "always"
    show_toast("Reference subs: Always Visible", 1.8)
  elseif state.ref_mode == "always" then
    state.ref_mode = "hidden"
    show_toast("Reference subs: Hidden", 1.8)
  else
    state.ref_mode = "peek"
    show_toast("Reference subs: Peek on Hover/Pause", 1.8)
  end
  render_all()
end

local function toggle_pause_at_cue_end()
  state.pause_at_cue_end = not state.pause_at_cue_end
  state.cue_end_paused_idx = nil
  show_toast("Pause at cue end: " .. (state.pause_at_cue_end and "ON" or "OFF"), 1.8)
end

---------------------------------------------------------------------------
-- Explicit Session Start / Re-Sync / Local Reference Switch
---------------------------------------------------------------------------
local function load_reference_track_local(track_id)
  if not track_id then
    state.ref_track_id = nil
    state.ref_cues = {}
    render_all()
    return
  end
  local tracks = get_text_sub_tracks()
  local target_track = nil
  for i = 1, #tracks do
    if tracks[i].id == track_id then
      target_track = tracks[i]
      break
    end
  end
  if not target_track then
    state.ref_track_id = nil
    state.ref_cues = {}
    render_all()
    return
  end
  local gen = state.session_gen
  sub.extract_track(target_track, function(ok, cues)
    if state.session_gen ~= gen then return end
    state.ref_track_id = track_id
    state.ref_cues = ok and cues or {}
    render_all()
  end)
end

local function start_or_resync_session(draft)
  if not draft or not draft.language_id or not draft.study_track_id then
    state.menu_error = "Select both a study language and a study subtitle track."
    render_all()
    return
  end

  local tracks = get_text_sub_tracks()
  local study_track = nil
  for i = 1, #tracks do
    if tracks[i].id == draft.study_track_id then
      study_track = tracks[i]
      break
    end
  end
  if not study_track then
    state.menu_error = "Selected study subtitle track is no longer available."
    render_all()
    return
  end

  state.sync_seq = state.sync_seq + 1
  local sync_id = state.sync_seq
  state.menu_busy = true
  state.menu_error = nil
  state.menu_status = "Extracting subtitle track..."
  render_all()

  local media_title = trim(mp.get_property("media-title") or "")
  if media_title == "" then
    media_title = trim(mp.get_property("filename/no-ext") or "Untitled mpv Session")
  end

  sub.extract_track(study_track, function(ext_ok, extracted_cues, ext_err)
    if sync_id ~= state.sync_seq then
      return
    end
    if not ext_ok or #extracted_cues == 0 then
      -- Live sub-text fallback for unsupported/non-extractable streams
      if state.active then
        flush_listening_and_progress(true)
      end
      reset_active_session_fields()
      state.menu_busy = false
      state.active = true
      state.live_fallback = true
      state.title = media_title
      state.language_id = draft.language_id
      local lang_obj = find_language_by_id(draft.language_id)
      state.language_code = lang_obj and lang_obj.code or ""
      state.study_track_id = draft.study_track_id
      state.ref_track_id = nil
      state.ref_mode = draft.ref_mode or "peek"
      state.live_sub_text = trim(mp.get_property("sub-text") or "")
      state.menu_open = false
      state.menu_status = nil
      state.menu_error = nil
      state.menu_confirm_resync = false
      if state.paused_by_menu then
        mp.set_property_native("pause", false)
        state.paused_by_menu = false
      end
      suppress_native_subs()
      set_osc_suppressed(true, true)
      update_keybindings()
      show_toast("Track extraction failed (" .. tostring(ext_err or "unsupported") .. "); using live sub-text fallback.", 4.5)
      return
    end

    state.menu_status = string.format("Syncing %d cues to LinguaRead...", #extracted_cues)
    render_all()

    local payload_cues = {}
    local cap = math.min(#extracted_cues, 5000)
    for i = 1, cap do
      local c = extracted_cues[i]
      payload_cues[i] = {
        startSeconds = c.startSeconds,
        endSeconds = c.endSeconds,
        text = c.text,
      }
    end

    net.request("POST", "/api/mpv/session", {
      languageId = draft.language_id,
      title = media_title,
      cues = payload_cues,
    }, { timeout = 90, playback_only = true }, function(api_ok, data, _, api_err)
      if sync_id ~= state.sync_seq then
        return
      end
      state.menu_busy = false
      if not api_ok or type(data) ~= "table" or not data.textId then
        state.menu_status = nil
        state.menu_error = tostring(api_err or "Failed to sync session with LinguaRead.")
        render_all()
        return
      end

      -- Flush previous session if re-syncing
      if state.active then
        flush_listening_and_progress(true)
      end
      reset_active_session_fields()

      state.active = true
      state.live_fallback = false
      state.text_id = data.textId
      state.title = data.title or media_title
      state.language_id = data.languageId or draft.language_id
      state.language_code = data.languageCode or ""
      state.study_revision = data.studyRevision or ""
      state.study_track_id = draft.study_track_id
      state.ref_mode = draft.ref_mode or "peek"
      state.auto_translate_override = draft.auto_translate or "auto"
      state.cues = data.cues or {}

      build_word_cache_from_cues(state.cues)
      suppress_native_subs()
      set_osc_suppressed(true, true)

      -- Load local reference track (zero network requests)
      if draft.ref_track_id and draft.ref_track_id ~= draft.study_track_id then
        load_reference_track_local(draft.ref_track_id)
      end

      -- Start periodic listening/progress flush timer
      local interval = math.max(10, tonumber(opts.sync_interval_seconds) or 60)
      state.sync_timer = mp.add_periodic_timer(interval, function()
        flush_listening_and_progress(false)
      end)

      -- Close menu & unpause if menu paused playback
      state.menu_open = false
      state.menu_status = nil
      state.menu_error = nil
      state.menu_confirm_resync = false
      if state.paused_by_menu then
        mp.set_property_native("pause", false)
        state.paused_by_menu = false
      end
      state.is_playing = not mp.get_property_native("pause")
      state.play_wall_start = state.is_playing and mp.get_time() or nil

      update_keybindings()
      render_all()

      -- Background auto-translate if enabled
      local should_auto = (state.auto_translate_override == "on")
        or (state.auto_translate_override == "auto" and state.server_prefs.autoTranslateOnOpen == true)
      if should_auto then
        trigger_auto_translate(state.text_id, state.auto_translate_override == "on")
      end
    end)
  end)
end

---------------------------------------------------------------------------
-- Ctrl+l Setup Picker Menu
---------------------------------------------------------------------------
local menu = {}

local function build_menu_rows()
  local d = state.menu_draft
  local rows = {}
  local lang_obj = find_language_by_id(d.language_id)
  local study_track = nil
  local ref_track = nil
  for i = 1, #d.tracks do
    if d.tracks[i].id == d.study_track_id then study_track = d.tracks[i] end
    if d.tracks[i].id == d.ref_track_id then ref_track = d.tracks[i] end
  end

  local ref_mode_label = d.ref_mode == "always" and "Always Visible"
    or (d.ref_mode == "hidden" and "Hidden" or "Peek on Hover/Pause")
  local auto_default = state.server_prefs.autoTranslateOnOpen and "On" or "Off"
  local auto_label = d.auto_translate == "on" and "On"
    or (d.auto_translate == "off" and "Off" or ("Auto (Settings: " .. auto_default .. ")"))

  rows[#rows + 1] = {
    id = "language",
    kind = "cycle",
    label = "Study Language",
    value = lang_obj and (lang_obj.name .. " (" .. lang_obj.code .. ")") or "None",
  }
  rows[#rows + 1] = {
    id = "study_track",
    kind = "cycle",
    label = "Study Sub Track",
    value = study_track and format_track_label(study_track) or "No text tracks found",
  }
  rows[#rows + 1] = {
    id = "ref_track",
    kind = "cycle",
    label = "Reference Sub Track",
    value = ref_track and format_track_label(ref_track) or "None",
  }
  rows[#rows + 1] = {
    id = "ref_mode",
    kind = "cycle",
    label = "Reference Display Mode",
    value = ref_mode_label,
  }
  rows[#rows + 1] = {
    id = "auto_translate",
    kind = "cycle",
    label = "Auto-Translate Unknown Words",
    value = auto_label,
  }

  if not state.active then
    rows[#rows + 1] = {
      id = "start_sync",
      kind = "action",
      label = "[Start & Sync Episode to Library]",
    }
    rows[#rows + 1] = {
      id = "cancel",
      kind = "action",
      label = "[Cancel]",
    }
  else
    rows[#rows + 1] = {
      id = "apply_display",
      kind = "action",
      label = "[Apply Display Settings] (local only)",
    }
    rows[#rows + 1] = {
      id = "auto_translate_now",
      kind = "action",
      label = "[Run Auto-Translate Now]",
    }
    local study_changed = (d.language_id ~= state.language_id) or (d.study_track_id ~= state.study_track_id)
    if study_changed then
      rows[#rows + 1] = {
        id = "resync",
        kind = "action",
        label = state.menu_confirm_resync
          and "[Confirm Re-Sync Study Track to Library]"
          or "[Re-Sync Study Track to Library]",
      }
    end
    rows[#rows + 1] = {
      id = "stop_session",
      kind = "action",
      label = "[Stop Session]",
    }
    rows[#rows + 1] = {
      id = "cancel",
      kind = "action",
      label = "[Close Menu]",
    }
  end

  state.menu_rows = rows
  if state.menu_cursor < 1 then state.menu_cursor = 1 end
  if state.menu_cursor > #rows then state.menu_cursor = #rows end
end

local function cycle_draft_field(row_id, dir)
  local d = state.menu_draft
  if not d then return end
  state.menu_confirm_resync = false

  if row_id == "language" and #state.languages > 0 then
    local _, idx = find_language_by_id(d.language_id)
    idx = idx or 1
    local next_idx = ((idx - 1 + dir) % #state.languages) + 1
    d.language_id = state.languages[next_idx].languageId
  elseif row_id == "study_track" and #d.tracks > 0 then
    local idx = 1
    for i = 1, #d.tracks do
      if d.tracks[i].id == d.study_track_id then idx = i break end
    end
    local next_idx = ((idx - 1 + dir) % #d.tracks) + 1
    d.study_track_id = d.tracks[next_idx].id
  elseif row_id == "ref_track" then
    local options_ids = { false }
    for i = 1, #d.tracks do
      options_ids[#options_ids + 1] = d.tracks[i].id
    end
    local idx = 1
    for i = 1, #options_ids do
      if (options_ids[i] or nil) == d.ref_track_id then idx = i break end
    end
    local next_idx = ((idx - 1 + dir) % #options_ids) + 1
    d.ref_track_id = options_ids[next_idx] or nil
  elseif row_id == "ref_mode" then
    local modes = { "peek", "always", "hidden" }
    local idx = 1
    for i = 1, #modes do
      if modes[i] == d.ref_mode then idx = i break end
    end
    local next_idx = ((idx - 1 + dir) % #modes) + 1
    d.ref_mode = modes[next_idx]
  elseif row_id == "auto_translate" then
    local vals = { "auto", "on", "off" }
    local idx = 1
    for i = 1, #vals do
      if vals[i] == d.auto_translate then idx = i break end
    end
    local next_idx = ((idx - 1 + dir) % #vals) + 1
    d.auto_translate = vals[next_idx]
  end
  build_menu_rows()
  render_all()
end

function menu.close()
  if not state.menu_open then return end
  state.sync_seq = state.sync_seq + 1
  state.menu_busy = false
  state.menu_open = false
  state.menu_error = nil
  state.menu_status = nil
  state.menu_confirm_resync = false
  if state.paused_by_menu then
    mp.set_property_native("pause", false)
    state.paused_by_menu = false
  end
  if not state.active then
    set_osc_suppressed(false)
  end
  update_keybindings()
  render_all()
end

local function activate_menu_row(idx)
  if state.menu_busy then return end
  local row = state.menu_rows[idx]
  if not row then return end

  if row.kind == "cycle" then
    cycle_draft_field(row.id, 1)
    return
  end

  if row.id == "cancel" then
    menu.close()
  elseif row.id == "start_sync" then
    start_or_resync_session(state.menu_draft)
  elseif row.id == "apply_display" then
    local d = state.menu_draft
    state.ref_mode = d.ref_mode
    state.auto_translate_override = d.auto_translate
    if d.ref_track_id ~= state.ref_track_id then
      load_reference_track_local(d.ref_track_id)
    end
    menu.close()
    show_toast("Display settings updated locally.", 2.0)
  elseif row.id == "auto_translate_now" then
    if state.text_id then
      local tid = state.text_id
      menu.close()
      trigger_auto_translate(tid, true)
    end
  elseif row.id == "resync" then
    if not state.menu_confirm_resync then
      state.menu_confirm_resync = true
      build_menu_rows()
      render_all()
    else
      start_or_resync_session(state.menu_draft)
    end
  elseif row.id == "stop_session" then
    state.menu_open = false
    state.paused_by_menu = false
    stop_session("LinguaRead session stopped.")
  end
end

local function init_menu_draft()
  local tracks = get_text_sub_tracks()
  local active_sid = mp.get_property_native("sid")
  local active_sec = mp.get_property_native("secondary-sid")

  local study_track = nil
  local ref_track = nil

  if state.active then
    for i = 1, #tracks do
      if tracks[i].id == state.study_track_id then study_track = tracks[i] end
      if tracks[i].id == state.ref_track_id then ref_track = tracks[i] end
    end
  end

  if not study_track then
    for i = 1, #tracks do
      if tracks[i].id == active_sid then study_track = tracks[i] break end
    end
  end
  if not study_track and #tracks > 0 then
    study_track = tracks[1]
  end

  if not state.active and not ref_track and active_sec then
    for i = 1, #tracks do
      if tracks[i].id == active_sec and (not study_track or tracks[i].id ~= study_track.id) then
        ref_track = tracks[i]
        break
      end
    end
  end

  local lang_id = state.active and state.language_id
    or map_track_lang_to_lingua_id(study_track and study_track.lang, state.languages, state.server_prefs.defaultLanguageId)

  state.menu_draft = {
    tracks = tracks,
    language_id = lang_id,
    study_track_id = study_track and study_track.id or nil,
    ref_track_id = ref_track and ref_track.id or nil,
    ref_mode = state.ref_mode,
    auto_translate = state.auto_translate_override,
  }
  state.menu_cursor = state.active and 6 or (#tracks > 0 and 6 or 1)
  state.menu_confirm_resync = false
  build_menu_rows()
end

function menu.open()
  if state.menu_open then
    menu.close()
    return
  end

  if state.popup then
    state.popup = nil
  end

  if not mp.get_property_native("pause") then
    mp.set_property_native("pause", true)
    state.paused_by_menu = true
  else
    state.paused_by_menu = false
  end

  state.menu_open = true
  state.menu_error = nil
  state.menu_status = nil
  state.menu_confirm_resync = false
  set_osc_suppressed(true, true)
  init_menu_draft()
  update_keybindings()
  render_all()

  if not state.languages_loading then
    state.languages_loading = true
    net.request("GET", "/api/mpv/languages", nil, { timeout = 15, playback_only = true }, function(ok, data, _, err)
      state.languages_loading = false
      if not ok or type(data) ~= "table" then
        state.menu_error = "Could not reach LinguaRead server: " .. tostring(err)
        render_all()
        return
      end
      state.languages = data.languages or {}
      state.languages_loaded = true
      state.server_prefs = {
        translationTargetLanguageCode = data.translationTargetLanguageCode or "EN",
        pauseOnWordClick = data.pauseOnWordClick == true,
        autoTranslateWords = data.autoTranslateWords ~= false,
        autoTranslateOnOpen = data.autoTranslateOnOpen == true,
        autoTranslateWordStatus = tonumber(data.autoTranslateWordStatus) or 5,
        wordTranslationProvider = data.wordTranslationProvider or "deepl",
        defaultLanguageId = tonumber(data.defaultLanguageId) or 0,
      }
      if state.menu_open and state.menu_draft then
        if not state.active then
          local st = nil
          for i = 1, #state.menu_draft.tracks do
            if state.menu_draft.tracks[i].id == state.menu_draft.study_track_id then
              st = state.menu_draft.tracks[i]
              break
            end
          end
          state.menu_draft.language_id = map_track_lang_to_lingua_id(
            st and st.lang, state.languages, state.server_prefs.defaultLanguageId
          )
        end
        build_menu_rows()
        render_all()
      end
    end)
  end
end

function menu.toggle()
  if state.menu_open then
    menu.close()
  else
    menu.open()
  end
end

---------------------------------------------------------------------------
-- OSD Layout & Rendering (ASS events, dynamic aspect ratio, exact hit rects)
---------------------------------------------------------------------------
local function wrap_cue_tokens(tokens, font_size, max_width)
  local rows = {}
  local cur_row = {}
  local cur_w = 0

  local function push_row()
    -- Trim trailing whitespace-only tokens on wrapped rows
    while #cur_row > 0 and not cur_row[#cur_row].isWord and trim(cur_row[#cur_row].text) == "" do
      local popped = table.remove(cur_row)
      cur_w = cur_w - popped.width
    end
    rows[#rows + 1] = { items = cur_row, width = math.max(0, cur_w) }
    cur_row = {}
    cur_w = 0
  end

  for idx = 1, #tokens do
    local tok = resolve_cue_token_state(tokens[idx])
    local raw = tok.text or ""
    if raw:find("\n", 1, true) then
      local pos = 1
      local raw_len = #raw
      while pos <= raw_len do
        local nl = raw:find("\n", pos, true)
        if not nl then
          local part = raw:sub(pos)
          if part ~= "" then
            local pw = utf8x.measure_px(part, font_size)
            if #cur_row > 0 and (cur_w + pw) > max_width then
              push_row()
            end
            cur_row[#cur_row + 1] = {
              tok_idx = idx,
              text = part,
              isWord = tok.isWord,
              status = tok.status or 0,
              term = tok.term or "",
              width = pw,
            }
            cur_w = cur_w + pw
          end
          break
        end
        if nl > pos then
          local part = raw:sub(pos, nl - 1)
          local pw = utf8x.measure_px(part, font_size)
          if #cur_row > 0 and (cur_w + pw) > max_width then
            push_row()
          end
          cur_row[#cur_row + 1] = {
            tok_idx = idx,
            text = part,
            isWord = tok.isWord,
            status = tok.status or 0,
            term = tok.term or "",
            width = pw,
          }
          cur_w = cur_w + pw
        end
        push_row()
        pos = nl + 1
      end
    else
      local w = utf8x.measure_px(raw, font_size)
      if #cur_row == 0 and not tok.isWord and trim(raw) == "" then
        -- Skip leading space at start of wrapped line
      else
        if #cur_row > 0 and tok.isWord and (cur_w + w) > max_width then
          push_row()
        end
        cur_row[#cur_row + 1] = {
          tok_idx = idx,
          text = raw,
          isWord = tok.isWord,
          status = tok.status or 0,
          term = tok.term or "",
          width = w,
        }
        cur_w = cur_w + w
      end
    end
  end

  if #cur_row > 0 or #rows == 0 then
    push_row()
  end
  return rows
end

local function wrap_plain_text(text, font_size, max_width)
  local lines = {}
  for para in (tostring(text or "") .. "\n"):gmatch("([^\n]*)\n") do
    local cur = ""
    local cur_w = 0
    for word in para:gmatch("%S+") do
      local space_w = cur ~= "" and utf8x.measure_px(" ", font_size) or 0
      local ww = utf8x.measure_px(word, font_size)
      if cur ~= "" and (cur_w + space_w + ww) > max_width then
        lines[#lines + 1] = { text = cur, width = cur_w }
        cur = word
        cur_w = ww
      else
        cur = cur ~= "" and (cur .. " " .. word) or word
        cur_w = cur_w + space_w + ww
      end
    end
    if cur ~= "" or #lines == 0 then
      lines[#lines + 1] = { text = cur, width = cur_w }
    end
  end
  return lines
end

local function ass_rect(x0, y0, x1, y1, color_bgr, alpha_hex)
  local w = math.max(1, math.floor(x1 - x0 + 0.5))
  local h = math.max(1, math.floor(y1 - y0 + 0.5))
  return string.format(
    "{\\an7\\pos(%.1f,%.1f)\\p1\\bord0\\shad0\\1c&H%s&\\1a&H%s&}m 0 0 l %d 0 %d %d 0 %d{\\p0}",
    x0, y0, color_bgr, alpha_hex or "22", w, w, h, h
  )
end

local function ass_rounded_rect(x0, y0, x1, y1, radius, color_bgr, alpha_hex, border_bgr, border_alpha)
  local w = math.max(2, math.floor(x1 - x0 + 0.5))
  local h = math.max(2, math.floor(y1 - y0 + 0.5))
  local r = math.max(0, math.min(math.floor(radius or 10), math.floor(w / 2), math.floor(h / 2)))
  if r < 2 then
    return ass_rect(x0, y0, x1, y1, color_bgr, alpha_hex)
  end
  local k = math.floor(r * 0.5523 + 0.5)
  local c = r - k
  local border_tag = border_bgr
    and string.format("\\bord1\\3c&H%s&\\3a&H%s&", border_bgr, border_alpha or "40")
    or "\\bord0"
  return string.format(
    "{\\an7\\pos(%.1f,%.1f)\\p1%s\\shad0\\1c&H%s&\\1a&H%s&}m %d 0 l %d 0 b %d 0 %d %d %d %d l %d %d b %d %d %d %d %d %d l %d %d b %d %d 0 %d 0 %d l 0 %d b 0 %d %d 0 %d 0{\\p0}",
    x0, y0, border_tag, color_bgr, alpha_hex or "22",
    r, w - r,
    w - c, w, c, w, r,
    w, h - r,
    w, h - c, w - c, h, w - r, h,
    r, h,
    c, h, h - c, h - r,
    r,
    c, c, r
  )
end

local function render_main_subtitles()
  state.token_rects = {}
  state.sub_zone_rect = nil

  local events = {}
  if state.toast_text and state.toast_text ~= "" then
    local toast_fs = 24
    local toast_str = utf8x.truncate(state.toast_text, 76)
    local toast_w = math.min(state.res_x - 80, math.max(180, math.floor(utf8x.measure_px(toast_str, toast_fs) + 44)))
    local toast_h = 40
    local tx0 = (state.res_x - toast_w) / 2
    local ty0 = 20
    events[#events + 1] = ass_rounded_rect(tx0, ty0, tx0 + toast_w, ty0 + toast_h, 10, "14121A", "1C", "3C3848", "50")
    events[#events + 1] = string.format(
      "{\\an5\\pos(%.1f,%.1f)\\q2\\fn%s\\fs%d\\bord0\\shad0\\1c&HFFFFFF&}%s",
      state.res_x / 2, ty0 + toast_h / 2, opts.font_name, toast_fs, ass_escape(toast_str)
    )
  end

  if not state.active then
    overlay_main.data = table.concat(events, "\n")
    overlay_main:update()
    return
  end

  local font_size = tonumber(opts.font_size) or 44
  local ref_font_size = tonumber(opts.ref_font_size) or 32
  local margin_bottom = tonumber(opts.margin_bottom) or 34
  local max_width = state.res_x * (tonumber(opts.max_line_width_ratio) or 0.84)

  local pos = mp.get_property_native("time-pos")
  local active_ref_lines = {}
  local show_ref = (state.ref_mode == "always")
    or (state.ref_mode == "peek" and (state.hover_in_sub_zone or state.popup ~= nil or mp.get_property_native("pause")))
  if show_ref and #state.ref_cues > 0 and type(pos) == "number" then
    local ref_indices = find_cues_at_time(state.ref_cues, pos)
    if #ref_indices > 0 then
      local combined_ref = {}
      for i = 1, #ref_indices do
        combined_ref[#combined_ref + 1] = state.ref_cues[ref_indices[i]].text
      end
      active_ref_lines = wrap_plain_text(table.concat(combined_ref, "\n"), ref_font_size, max_width)
    end
  end

  local ref_line_h = math.floor(ref_font_size * 1.22 + 0.5)

  local primary_rows = {}
  local cue_idx = state.current_cue_idx
  local cue = cue_idx and state.cues[cue_idx] or nil

  if cue and cue.tokens and #cue.tokens > 0 then
    primary_rows = wrap_cue_tokens(cue.tokens, font_size, max_width)
  elseif state.live_fallback and state.live_sub_text ~= "" then
    -- Lightweight live tokenization so words remain clickable in live fallback mode
    local live_tokens = {}
    local idx = 1
    local s = state.live_sub_text
    local n = #s
    while idx <= n do
      local ws_s, ws_e = s:find("^[%s%p]+", idx)
      if ws_s then
        live_tokens[#live_tokens + 1] = { text = s:sub(ws_s, ws_e), term = "", isWord = false, status = 0 }
        idx = ws_e + 1
      else
        local w_s, w_e = s:find("^[^%s%p]+", idx)
        if not w_s then break end
        local w = s:sub(w_s, w_e)
        live_tokens[#live_tokens + 1] = { text = w, term = w:lower(), isWord = true, status = 0 }
        idx = w_e + 1
      end
    end
    state.cues[1] = {
      startSeconds = mp.get_property_native("sub-start") or 0,
      endSeconds = mp.get_property_native("sub-end") or 0,
      text = state.live_sub_text,
      tokens = live_tokens,
    }
    cue_idx = 1
    primary_rows = wrap_cue_tokens(live_tokens, font_size, max_width)
  end

  local pri_line_h = math.floor(font_size * 1.20 + 0.5)
  local pri_ink_h = #primary_rows > 0 and ((#primary_rows - 1) * pri_line_h + font_size) or 0
  local ref_gap = (#primary_rows > 0 and #active_ref_lines > 0) and 8 or 0
  local ref_ink_h = #active_ref_lines > 0 and ((#active_ref_lines - 1) * ref_line_h + ref_font_size) or 0
  local total_ink_h = pri_ink_h + ref_gap + ref_ink_h
  local base_y = state.res_y - margin_bottom - total_ink_h

  if #primary_rows > 0 or #active_ref_lines > 0 then
    local max_w = 0
    for i = 1, #primary_rows do
      if primary_rows[i].width > max_w then max_w = primary_rows[i].width end
    end
    for i = 1, #active_ref_lines do
      if active_ref_lines[i].width > max_w then max_w = active_ref_lines[i].width end
    end
    local pad_x = 22
    local pad_y = 12
    local box_w = math.min(state.res_x - 32, max_w + pad_x * 2)
    local box_x0 = (state.res_x - box_w) / 2
    local box_y0 = base_y - pad_y
    local box_y1 = base_y + total_ink_h + pad_y
    state.sub_zone_rect = { x0 = box_x0, y0 = box_y0, x1 = box_x0 + box_w, y1 = box_y1 }
    local box_mode = trim(tostring(opts.subtitle_box or "none")):lower()
    local show_box = (box_mode == "always")
      or (box_mode == "hover" and (state.hover_in_sub_zone or state.popup ~= nil or #active_ref_lines > 0))
    if show_box then
      events[#events + 1] = ass_rounded_rect(box_x0, box_y0, box_x0 + box_w, box_y1, 12, "100E14", "34", "3A3848", "68")
    end
  end

  local cur_y = base_y
  for r = 1, #primary_rows do
    local row = primary_rows[r]
    local cur_x = (state.res_x - row.width) / 2
    local line_parts = {
      string.format(
        "{\\an8\\pos(%.1f,%.1f)\\q2\\fn%s\\fs%d\\bord2.8\\shad1.6\\3c&H0A0A0E&\\4c&H000000&\\4a&H45&}",
        state.res_x / 2, cur_y, opts.font_name, font_size
      )
    }
    local cur_color, cur_u = nil, nil

    for k = 1, #row.items do
      local item = row.items[k]
      local is_hovered = (state.hover_cue_idx == cue_idx and state.hover_tok_idx == item.tok_idx and item.isWord)
      local is_selected = (state.popup and state.popup.cue_idx == cue_idx
        and item.tok_idx >= state.popup.start_idx and item.tok_idx <= state.popup.end_idx)
      local color
      local u = 0
      if is_selected or is_hovered then
        color = "33EEFF"
        u = 1
      elseif item.isWord then
        color = STATUS_COLORS_BGR[item.status] or "FFFFFF"
      else
        color = "EBEBF2"
      end

      if item.isWord and cue_idx then
        state.token_rects[#state.token_rects + 1] = {
          cue_idx = cue_idx,
          tok_idx = item.tok_idx,
          x0 = cur_x - 3,
          y0 = cur_y - 2,
          x1 = cur_x + item.width + 3,
          y1 = cur_y + pri_line_h,
        }
      end

      if color ~= cur_color or u ~= cur_u then
        line_parts[#line_parts + 1] = string.format("{\\1c&H%s&\\u%d}", color, u)
        cur_color = color
        cur_u = u
      end
      line_parts[#line_parts + 1] = ass_escape(item.text)
      cur_x = cur_x + item.width
    end

    events[#events + 1] = table.concat(line_parts)
    cur_y = cur_y + pri_line_h
  end

  if #active_ref_lines > 0 then
    cur_y = base_y + pri_ink_h + ref_gap
    for r = 1, #active_ref_lines do
      events[#events + 1] = string.format(
        "{\\an8\\pos(%.1f,%.1f)\\q2\\fn%s\\fs%d\\bord2.2\\shad1.3\\1c&HD8DEE4&\\3c&H0A0A0E&\\4c&H000000&\\4a&H45&}%s",
        state.res_x / 2, cur_y, opts.font_name, ref_font_size, ass_escape(active_ref_lines[r].text)
      )
      cur_y = cur_y + ref_line_h
    end
  end

  overlay_main.data = table.concat(events, "\n")
  overlay_main:update()
end

local function render_popup()
  local p = state.popup
  if not p then
    if opts.hover_tooltip and state.active and not state.menu_open and state.hover_cue_idx and state.hover_tok_idx then
      local cue = state.cues[state.hover_cue_idx]
      local tok = cue and cue.tokens and cue.tokens[state.hover_tok_idx]
      local resolved = tok and resolve_cue_token_state(tok) or nil
      if resolved and resolved.isWord and type(resolved.translation) == "string" and trim(resolved.translation) ~= "" then
        local tr = nil
        for i = 1, #state.token_rects do
          local r = state.token_rects[i]
          if r.cue_idx == state.hover_cue_idx and r.tok_idx == state.hover_tok_idx then
            tr = r
            break
          end
        end
        local t_word = utf8x.truncate(resolved.term ~= "" and resolved.term or resolved.text, 32)
        local t_trans = utf8x.truncate(trim(resolved.translation):gsub("\r?\n", " "), 72)
        local tip_fs = 22
        local tip_text = t_word .. "  ·  " .. t_trans
        local pill_w = math.min(state.res_x - 48, math.max(120, math.floor(utf8x.measure_px(tip_text, tip_fs) + 32)))
        local pill_h = 36
        local center_x = tr and ((tr.x0 + tr.x1) / 2) or (state.res_x / 2)
        local px0 = math.max(24, math.min(state.res_x - pill_w - 24, math.floor(center_x - pill_w / 2)))
        local anchor_y = (state.sub_zone_rect and state.sub_zone_rect.y0) or (tr and tr.y0) or (state.res_y - 120)
        local py0 = math.max(20, math.floor(anchor_y - pill_h - 12))
        local st_color = STATUS_COLORS_BGR[resolved.status or 0] or "FFFFFF"
        local tip_events = {
          ass_rounded_rect(px0, py0, px0 + pill_w, py0 + pill_h, 9, "14121A", "18", "3E3A4C", "50"),
          string.format(
            "{\\an5\\pos(%.1f,%.1f)\\q2\\fn%s\\fs%d\\b1\\bord0\\shad0\\1c&H%s&}%s{\\b0\\1c&H9090A0&}  ·  {\\1c&HF4F4F8&}%s",
            px0 + pill_w / 2, py0 + pill_h / 2, opts.font_name, tip_fs, st_color, ass_escape(t_word), ass_escape(t_trans)
          ),
        }
        overlay_popup.data = table.concat(tip_events, "\n")
        overlay_popup:update()
        return
      end
    end
    overlay_popup.data = ""
    overlay_popup:update()
    return
  end

  p.buttons = {}
  local box_w = math.min(680, state.res_x - 80)
  local inner_w = box_w - 44
  local trans_fs = 26
  local header_fs = 29
  local btn_fs = 21

  local trans_str = p.loading and "Translating..."
    or (p.error and ("Error: " .. p.error))
    or ((p.translation and p.translation ~= "") and p.translation)
    or "(No translation — press e for AI context or 1-5 to save)"

  local trans_lines = wrap_plain_text(trans_str, trans_fs, inner_w)
  local sent_lines = {}
  if p.sentence_translation and p.sentence_translation ~= "" then
    sent_lines = wrap_plain_text("Sentence: " .. p.sentence_translation, 22, inner_w)
  end

  local btn_defs = {
    { label = "1", action = "grade", val = 1 },
    { label = "2", action = "grade", val = 2 },
    { label = "3", action = "grade", val = 3 },
    { label = "4", action = "grade", val = 4 },
    { label = "5", action = "grade", val = 5 },
    { label = "Ignore (i)", action = "grade", val = 6 },
    { label = "Sentence (t)", action = "sent" },
    { label = "AI Context (e)", action = "ai" },
    { label = "Replay (r)", action = "replay" },
  }

  local header_h = 44
  local trans_h = math.max(1, #trans_lines) * 32
  local sent_h = #sent_lines > 0 and (#sent_lines * 28 + 10) or 0
  local btn_rows = { {} }
  local cur_bw = 0
  for i = 1, #btn_defs do
    local b = btn_defs[i]
    local bw = math.max(36, math.floor(utf8x.measure_px(b.label, btn_fs) + 22))
    local row = btn_rows[#btn_rows]
    if #row > 0 and (cur_bw + 8 + bw) > inner_w then
      row = {}
      btn_rows[#btn_rows + 1] = row
      cur_bw = 0
    end
    row[#row + 1] = { def = b, width = bw }
    cur_bw = cur_bw + (#row > 1 and 8 or 0) + bw
  end
  local btn_row_h = 40
  local btns_total_h = #btn_rows * btn_row_h
  local hint_h = 24
  local pad = 22
  local box_h = pad * 2 + header_h + trans_h + sent_h + btns_total_h + hint_h + 14

  local anchor_cx = state.res_x / 2
  local min_tx, max_tx = nil, nil
  for i = 1, #state.token_rects do
    local tr = state.token_rects[i]
    if tr.cue_idx == p.cue_idx and tr.tok_idx >= p.start_idx and tr.tok_idx <= p.end_idx then
      if not min_tx or tr.x0 < min_tx then min_tx = tr.x0 end
      if not max_tx or tr.x1 > max_tx then max_tx = tr.x1 end
    end
  end
  if min_tx and max_tx then
    anchor_cx = (min_tx + max_tx) / 2
  end
  local box_x0 = math.max(28, math.min(state.res_x - box_w - 28, math.floor(anchor_cx - box_w / 2)))
  local anchor_top = state.sub_zone_rect and (state.sub_zone_rect.y0 - 18) or (state.res_y - 240)
  local box_y0 = math.max(24, math.floor(anchor_top - box_h))

  local st_color = STATUS_COLORS_BGR[p.status or 0] or "FFFFFF"
  local events = {}
  events[#events + 1] = ass_rounded_rect(box_x0, box_y0, box_x0 + box_w, box_y0 + box_h, 14, "16141A", "10", "3E3A4C", "48")
  events[#events + 1] = ass_rounded_rect(box_x0 + 18, box_y0 + 1, box_x0 + box_w - 18, box_y0 + 5, 2, st_color, "00")

  local status_names = {
    [0] = "New", [1] = "Lv1", [2] = "Lv2", [3] = "Lv3", [4] = "Lv4", [5] = "Known", [6] = "Ignored"
  }
  local cy = box_y0 + pad
  local cx = box_x0 + pad
  local close_x0 = box_x0 + box_w - pad - 34
  local close_y0 = cy - 2
  local close_idx = #p.buttons + 1
  local hover_close = (state.hover_button_idx == close_idx)
  p.buttons[close_idx] = { x0 = close_x0, y0 = close_y0, x1 = close_x0 + 34, y1 = close_y0 + 30, action = "close" }
  events[#events + 1] = ass_rounded_rect(close_x0, close_y0, close_x0 + 34, close_y0 + 30, 7,
    hover_close and "3E3848" or "26232D", "14", hover_close and "686078" or "3A3646", "60")
  events[#events + 1] = string.format(
    "{\\an5\\pos(%.1f,%.1f)\\q2\\fn%s\\fs22\\b1\\bord0\\shad0\\1c&H%s&}×",
    close_x0 + 17, close_y0 + 15, opts.font_name, hover_close and "FFFFFF" or "B8B8C6"
  )

  local term_txt = utf8x.truncate(p.term or "", 30)
  events[#events + 1] = string.format(
    "{\\an7\\pos(%d,%d)\\q2\\fn%s\\fs%d\\b1\\bord0\\shad0\\1c&H%s&}%s",
    cx, cy, opts.font_name, header_fs, st_color, ass_escape(term_txt)
  )

  local badge_x = cx + math.floor(utf8x.measure_px(term_txt, header_fs) + 12)
  local badge_label = status_names[p.status or 0] or "?"
  local badge_w = math.floor(utf8x.measure_px(badge_label, 18) + 18)
  if badge_x + badge_w + 10 <= close_x0 then
    local badge_y = cy + 3
    events[#events + 1] = ass_rounded_rect(badge_x, badge_y, badge_x + badge_w, badge_y + 26, 7, "282530", "18", st_color, "48")
    events[#events + 1] = string.format(
      "{\\an5\\pos(%.1f,%.1f)\\q2\\fn%s\\fs17\\b1\\bord0\\shad0\\1c&H%s&}%s",
      badge_x + badge_w / 2, badge_y + 13, opts.font_name, st_color, ass_escape(badge_label)
    )
    if p.provider and p.provider ~= "" then
      local prov_x = badge_x + badge_w + 10
      local prov_txt = "·  " .. p.provider
      if prov_x + utf8x.measure_px(prov_txt, 18) + 8 <= close_x0 then
        events[#events + 1] = string.format(
          "{\\an7\\pos(%d,%d)\\q2\\fn%s\\fs18\\bord0\\shad0\\1c&H9A9AA8&}%s",
          prov_x, cy + 7, opts.font_name, ass_escape(prov_txt)
        )
      end
    end
  end

  cy = cy + header_h
  local trans_color = p.error and "6666FF" or "F4F4F6"
  for i = 1, #trans_lines do
    events[#events + 1] = string.format(
      "{\\an7\\pos(%d,%d)\\q2\\fn%s\\fs%d\\bord0\\shad0\\1c&H%s&}%s",
      cx, cy, opts.font_name, trans_fs, trans_color, ass_escape(trans_lines[i].text)
    )
    cy = cy + 32
  end

  if #sent_lines > 0 then
    cy = cy + 6
    for i = 1, #sent_lines do
      events[#events + 1] = string.format(
        "{\\an7\\pos(%d,%d)\\q2\\fn%s\\fs22\\bord0\\shad0\\1c&HA8E0C0&}%s",
        cx, cy, opts.font_name, ass_escape(sent_lines[i].text)
      )
      cy = cy + 28
    end
  end

  local grade_active_bg = {
    [1] = "303266", [2] = "2A4666", [3] = "2A5860", [4] = "305838", [5] = "385C3A", [6] = "3E3E48",
  }
  cy = cy + 10
  for r = 1, #btn_rows do
    local row = btn_rows[r]
    local bx = cx
    for i = 1, #row do
      local entry = row[i]
      local b = entry.def
      local bw = entry.width
      local bh = 34
      local active_grade = (b.action == "grade" and b.val == p.status)
      local btn_idx = #p.buttons + 1
      local is_hover_btn = (state.hover_button_idx == btn_idx)
      if active_grade then
        events[#events + 1] = ass_rounded_rect(bx, cy, bx + bw, cy + bh, 7,
          grade_active_bg[b.val] or "385C3A", "0C", STATUS_COLORS_BGR[b.val], "30")
      else
        events[#events + 1] = ass_rounded_rect(bx, cy, bx + bw, cy + bh, 7,
          is_hover_btn and "3E3946" or "26232C", "14", is_hover_btn and "686078" or "3A3646", "60")
      end
      events[#events + 1] = string.format(
        "{\\an5\\pos(%.1f,%.1f)\\q2\\fn%s\\fs%d\\bord0\\shad0\\1c&HFFFFFF&}%s",
        bx + bw / 2, cy + bh / 2, opts.font_name, btn_fs, ass_escape(b.label)
      )
      p.buttons[btn_idx] = { x0 = bx, y0 = cy, x1 = bx + bw, y1 = cy + bh, action = b.action, val = b.val }
      bx = bx + bw + 8
    end
    cy = cy + btn_row_h
  end

  cy = cy + 4
  events[#events + 1] = string.format(
    "{\\an7\\pos(%d,%d)\\q2\\fn%s\\fs18\\bord0\\shad0\\1c&H9A9AA6&}Phrase: Shift+Click or [ / ]   |   Wheel: adjust level   |   Esc: close",
    cx, cy, opts.font_name
  )

  p.rect = { x0 = box_x0, y0 = box_y0, x1 = box_x0 + box_w, y1 = box_y0 + box_h }
  overlay_popup.data = table.concat(events, "\n")
  overlay_popup:update()
end

local function render_menu()
  if not state.menu_open then
    state.menu_rect = nil
    overlay_menu.data = ""
    overlay_menu:update()
    return
  end

  build_menu_rows()
  local rows = state.menu_rows
  local box_w = math.min(860, state.res_x - 80)
  local row_h = 46
  local pad = 28
  local header_h = state.active and 92 or 66
  local status_h = (state.menu_error or state.menu_status) and 40 or 0
  local footer_h = 34
  local box_h = pad * 2 + header_h + (#rows * row_h) + status_h + footer_h

  local box_x0 = math.floor((state.res_x - box_w) / 2)
  local box_y0 = math.max(30, math.floor((state.res_y - box_h) / 2))
  state.menu_rect = { x0 = box_x0, y0 = box_y0, x1 = box_x0 + box_w, y1 = box_y0 + box_h }

  local events = {}
  events[#events + 1] = ass_rect(0, 0, state.res_x, state.res_y, "06060A", "88")
  events[#events + 1] = ass_rounded_rect(box_x0, box_y0, box_x0 + box_w, box_y0 + box_h, 14, "16141A", "0C", "3C3848", "50")
  events[#events + 1] = ass_rounded_rect(box_x0 + 18, box_y0 + 1, box_x0 + box_w - 18, box_y0 + 5, 2, "BC9C1A", "00")

  local cx = box_x0 + pad
  local cy = box_y0 + pad

  events[#events + 1] = string.format(
    "{\\an7\\pos(%d,%d)\\q2\\fn%s\\fs32\\b1\\bord0\\shad0\\1c&HFFFFFF&}LinguaRead mpv Setup",
    cx, cy, opts.font_name
  )
  cy = cy + 38

  if state.active then
    local sl = find_language_by_id(state.language_id)
    local info = string.format("Active: %s  (%s)",
      utf8x.truncate(state.title, 44),
      sl and sl.name or state.language_code)
    events[#events + 1] = string.format(
      "{\\an7\\pos(%d,%d)\\q2\\fn%s\\fs22\\bord0\\shad0\\1c&HA8E0C0&}%s",
      cx, cy, opts.font_name, ass_escape(info)
    )
    cy = cy + 30
  else
    events[#events + 1] = string.format(
      "{\\an7\\pos(%d,%d)\\q2\\fn%s\\fs21\\bord0\\shad0\\1c&HB0B0BC&}Deliberate import: nothing syncs until you click [Start & Sync Episode to Library].",
      cx, cy, opts.font_name
    )
    cy = cy + 28
  end

  cy = cy + 8
  for i = 1, #rows do
    local r = rows[i]
    local selected = (i == state.menu_cursor)
    local ry0 = cy
    local ry1 = cy + row_h - 6
    r.rect = { x0 = cx, y0 = ry0, x1 = box_x0 + box_w - pad, y1 = ry1 }

    if selected then
      events[#events + 1] = ass_rounded_rect(cx, ry0, box_x0 + box_w - pad, ry1, 8, "342F28", "14", "6A604E", "58")
    elseif r.kind == "action" then
      events[#events + 1] = ass_rounded_rect(cx, ry0, box_x0 + box_w - pad, ry1, 8, "242026", "28", "3A3544", "68")
    end

    local text_color = selected and "FFE58F" or (r.kind == "action" and "FFFFFF" or "DCE0E5")
    if r.id == "start_sync" or r.id == "resync" then
      text_color = selected and "88FFAA" or "A8E6B8"
    elseif r.id == "stop_session" then
      text_color = selected and "8888FF" or "9999EE"
    end

    if r.kind == "cycle" then
      events[#events + 1] = string.format(
        "{\\an7\\pos(%d,%d)\\q2\\fn%s\\fs24\\bord0\\shad0\\1c&H%s&}%s%s",
        cx + 12, ry0 + 7, opts.font_name, text_color, selected and "> " or "  ", ass_escape(r.label)
      )
      local arrow_color = selected and "FFE58F" or "8E94A0"
      local val_color = selected and "FFFFFF" or "E8ECF2"
      events[#events + 1] = string.format(
        "{\\an9\\pos(%d,%d)\\q2\\fn%s\\fs24\\b1\\bord0\\shad0\\1c&H%s&}< {\\1c&H%s&}%s{\\1c&H%s&} >",
        box_x0 + box_w - pad - 12, ry0 + 7, opts.font_name, arrow_color, val_color, ass_escape(tostring(r.value)), arrow_color
      )
    else
      events[#events + 1] = string.format(
        "{\\an7\\pos(%d,%d)\\q2\\fn%s\\fs24\\b1\\bord0\\shad0\\1c&H%s&}%s%s",
        cx + 12, ry0 + 7, opts.font_name, text_color, selected and "> " or "  ", ass_escape(r.label)
      )
    end

    cy = cy + row_h
  end

  if state.menu_error then
    events[#events + 1] = string.format(
      "{\\an7\\pos(%d,%d)\\q2\\fn%s\\fs21\\bord0\\shad0\\1c&H6666FF&}%s",
      cx, cy + 4, opts.font_name, ass_escape(utf8x.truncate(state.menu_error, 88))
    )
    cy = cy + 40
  elseif state.menu_status then
    events[#events + 1] = string.format(
      "{\\an7\\pos(%d,%d)\\q2\\fn%s\\fs21\\bord0\\shad0\\1c&HA8E0C0&}%s",
      cx, cy + 4, opts.font_name, ass_escape(utf8x.truncate(state.menu_status, 88))
    )
    cy = cy + 40
  end

  local footer_txt = opts.hide_osc_during_session
    and "Hover/Arrows: move   |   Click/Wheel: change   |   Esc: close   |   Del: seekbar"
    or "Hover/Arrows: move   |   Click/Wheel: change   |   Esc: close"
  events[#events + 1] = string.format(
    "{\\an7\\pos(%d,%d)\\q2\\fn%s\\fs18\\bord0\\shad0\\1c&H9696A2&}%s",
    cx, cy + 8, opts.font_name, footer_txt
  )

  overlay_menu.data = table.concat(events, "\n")
  overlay_menu:update()
end

render_all = function()
  render_main_subtitles()
  render_popup()
  render_menu()
end

---------------------------------------------------------------------------
-- Dynamic OSD dimensions, mouse hit-testing, & mpv.net-safe keybind manager
---------------------------------------------------------------------------
local function point_in_rect(x, y, r)
  return r and x >= r.x0 and x <= r.x1 and y >= r.y0 and y <= r.y1
end

local function on_mouse_click(shift_held)
  if state.menu_open then
    local mx, my = state.mouse_vx, state.mouse_vy
    for i = 1, #state.menu_rows do
      local r = state.menu_rows[i]
      if point_in_rect(mx, my, r.rect) then
        state.menu_cursor = i
        if r.kind == "cycle" then
          local mid = (r.rect.x0 + r.rect.x1) / 2
          cycle_draft_field(r.id, mx >= mid and 1 or -1)
        else
          activate_menu_row(i)
        end
        return
      end
    end
    if not point_in_rect(mx, my, state.menu_rect) then
      menu.close()
    end
    return
  end

  if state.popup and state.popup.buttons then
    for i = 1, #state.popup.buttons do
      local b = state.popup.buttons[i]
      if point_in_rect(state.mouse_vx, state.mouse_vy, b) then
        if b.action == "grade" then
          grade_active_word(b.val)
        elseif b.action == "sent" then
          fetch_lookup("word", true)
        elseif b.action == "ai" then
          fetch_lookup("context", false)
        elseif b.action == "replay" then
          replay_current_cue()
        elseif b.action == "close" then
          close_popup()
        end
        return
      end
    end
  end

  if state.hover_cue_idx and state.hover_tok_idx then
    if shift_held and state.popup and state.popup.cue_idx == state.hover_cue_idx then
      open_word_popup(state.hover_cue_idx, state.popup.anchor_idx, state.hover_tok_idx)
    else
      open_word_popup(state.hover_cue_idx, state.hover_tok_idx, state.hover_tok_idx)
    end
    return
  end

  if state.popup then
    close_popup()
  end
end

local MODAL_BINDINGS = {
  { "ESC", "lr-modal-esc", function() menu.close() end },
  { "ENTER", "lr-modal-enter", function() activate_menu_row(state.menu_cursor) end },
  { "UP", "lr-modal-up", function()
      if #state.menu_rows == 0 then return end
      state.menu_cursor = ((state.menu_cursor - 2) % #state.menu_rows) + 1
      render_menu()
    end, { repeatable = true } },
  { "DOWN", "lr-modal-down", function()
      if #state.menu_rows == 0 then return end
      state.menu_cursor = (state.menu_cursor % #state.menu_rows) + 1
      render_menu()
    end, { repeatable = true } },
  { "LEFT", "lr-modal-left", function()
      local row = state.menu_rows[state.menu_cursor]
      if row and row.kind == "cycle" then cycle_draft_field(row.id, -1) end
    end, { repeatable = true } },
  { "RIGHT", "lr-modal-right", function()
      local row = state.menu_rows[state.menu_cursor]
      if row and row.kind == "cycle" then cycle_draft_field(row.id, 1) end
    end, { repeatable = true } },
  { "WHEEL_UP", "lr-modal-wup", function()
      if #state.menu_rows == 0 then return end
      local row = state.menu_rows[state.menu_cursor]
      if row and row.kind == "cycle" then
        cycle_draft_field(row.id, -1)
      else
        state.menu_cursor = ((state.menu_cursor - 2) % #state.menu_rows) + 1
        render_menu()
      end
    end },
  { "WHEEL_DOWN", "lr-modal-wdown", function()
      if #state.menu_rows == 0 then return end
      local row = state.menu_rows[state.menu_cursor]
      if row and row.kind == "cycle" then
        cycle_draft_field(row.id, 1)
      else
        state.menu_cursor = (state.menu_cursor % #state.menu_rows) + 1
        render_menu()
      end
    end },
  { "MBTN_LEFT", "lr-modal-click", function() on_mouse_click(false) end },
  { "MBTN_LEFT_DBL", "lr-modal-dblclick", function() on_mouse_click(false) end },
}

local SESSION_BINDINGS = {
  { "v", "lr-session-ref-mode", cycle_ref_mode },
  { "a", "lr-session-cue-pause", toggle_pause_at_cue_end },
}

local WORD_HOVER_BINDINGS = {
  { "MBTN_LEFT", "lr-whover-click", function() on_mouse_click(false) end },
  { "MBTN_LEFT_DBL", "lr-whover-dblclick", function() on_mouse_click(false) end },
  { "Shift+MBTN_LEFT", "lr-whover-shift-click", function() on_mouse_click(true) end },
  { "1", "lr-whover-1", function() grade_active_word(1) end },
  { "2", "lr-whover-2", function() grade_active_word(2) end },
  { "3", "lr-whover-3", function() grade_active_word(3) end },
  { "4", "lr-whover-4", function() grade_active_word(4) end },
  { "5", "lr-whover-5", function() grade_active_word(5) end },
  { "i", "lr-whover-6", function() grade_active_word(6) end },
  { "r", "lr-whover-replay", replay_current_cue },
}

local POPUP_BINDINGS = {
  { "MBTN_LEFT", "lr-popup-click", function() on_mouse_click(false) end },
  { "MBTN_LEFT_DBL", "lr-popup-dblclick", function() on_mouse_click(false) end },
  { "Shift+MBTN_LEFT", "lr-popup-shift-click", function() on_mouse_click(true) end },
  { "WHEEL_UP", "lr-popup-wup", function() step_word_status(-1) end },
  { "WHEEL_DOWN", "lr-popup-wdown", function() step_word_status(1) end },
  { "LEFT", "lr-popup-left", function() adjust_phrase_selection(-1) end, { repeatable = true } },
  { "RIGHT", "lr-popup-right", function() adjust_phrase_selection(1) end, { repeatable = true } },
  { "[", "lr-popup-shrink", function() adjust_phrase_selection(-1) end, { repeatable = true } },
  { "]", "lr-popup-expand", function() adjust_phrase_selection(1) end, { repeatable = true } },
  { "1", "lr-grade-1", function() grade_active_word(1) end },
  { "2", "lr-grade-2", function() grade_active_word(2) end },
  { "3", "lr-grade-3", function() grade_active_word(3) end },
  { "4", "lr-grade-4", function() grade_active_word(4) end },
  { "5", "lr-grade-5", function() grade_active_word(5) end },
  { "i", "lr-grade-6", function() grade_active_word(6) end },
  { "t", "lr-lookup-sent", function() fetch_lookup("word", true) end },
  { "e", "lr-lookup-ai", function() fetch_lookup("context", false) end },
  { "r", "lr-replay-cue", replay_current_cue },
  { "ESC", "lr-popup-esc", close_popup },
}

local function attach_bindings(list)
  for i = 1, #list do
    local b = list[i]
    mp.add_forced_key_binding(b[1], b[2], b[3], b[4])
  end
end

local function detach_bindings(list)
  for i = 1, #list do
    mp.remove_key_binding(list[i][2])
  end
end

update_keybindings = function()
  local want_modal = state.menu_open
  local want_session = (not want_modal) and state.active
  local want_popup = want_session and state.popup ~= nil
  local want_word_hover = want_session and (not want_popup) and (state.hover_tok_idx ~= nil)

  if not want_modal and state.modal_keys_bound then
    detach_bindings(MODAL_BINDINGS)
    state.modal_keys_bound = false
  end
  if not want_session and state.session_keys_bound then
    detach_bindings(SESSION_BINDINGS)
    state.session_keys_bound = false
  end
  if not want_word_hover and state.word_hover_keys_bound then
    detach_bindings(WORD_HOVER_BINDINGS)
    state.word_hover_keys_bound = false
  end
  if not want_popup and state.popup_keys_bound then
    detach_bindings(POPUP_BINDINGS)
    state.popup_keys_bound = false
  end

  if want_session and not state.session_keys_bound then
    attach_bindings(SESSION_BINDINGS)
    state.session_keys_bound = true
  end
  if want_word_hover and not state.word_hover_keys_bound then
    attach_bindings(WORD_HOVER_BINDINGS)
    state.word_hover_keys_bound = true
  end
  if want_popup and not state.popup_keys_bound then
    attach_bindings(POPUP_BINDINGS)
    state.popup_keys_bound = true
  end
  if want_modal and not state.modal_keys_bound then
    attach_bindings(MODAL_BINDINGS)
    state.modal_keys_bound = true
  end
end

local function sync_overlay_dimensions()
  local w, h = mp.get_osd_size()
  if not w or w <= 0 then w = 1280 end
  if not h or h <= 0 then h = 720 end
  state.osd_w = w
  state.osd_h = h
  state.res_y = 1080
  state.res_x = math.max(1, math.floor(1080 * w / h + 0.5))

  overlay_main.res_x = state.res_x
  overlay_main.res_y = state.res_y
  overlay_popup.res_x = state.res_x
  overlay_popup.res_y = state.res_y
  overlay_menu.res_x = state.res_x
  overlay_menu.res_y = state.res_y

  render_all()
end

local function recompute_hover_from_mouse()
  if not state.mouse_in_window or state.menu_open or not state.active then
    return false
  end

  local vx = state.mouse_vx
  local vy = state.mouse_vy
  local prev_tok = state.hover_tok_idx
  local prev_zone = state.hover_in_sub_zone
  local prev_btn = state.hover_button_idx

  state.hover_cue_idx = nil
  state.hover_tok_idx = nil
  state.hover_in_sub_zone = point_in_rect(vx, vy, state.sub_zone_rect)
  state.hover_button_idx = nil

  if state.popup and state.popup.buttons then
    for i = 1, #state.popup.buttons do
      if point_in_rect(vx, vy, state.popup.buttons[i]) then
        state.hover_button_idx = i
        break
      end
    end
  end

  for i = 1, #state.token_rects do
    local tr = state.token_rects[i]
    if point_in_rect(vx, vy, tr) then
      state.hover_cue_idx = tr.cue_idx
      state.hover_tok_idx = tr.tok_idx
      break
    end
  end

  if opts.pause_on_hover and not state.popup then
    if state.hover_in_sub_zone and not prev_zone then
      ensure_script_pause(true)
    elseif not state.hover_in_sub_zone and prev_zone and state.paused_by_hover then
      release_script_pause_if_owned()
    end
  end

  return prev_tok ~= state.hover_tok_idx or prev_zone ~= state.hover_in_sub_zone or prev_btn ~= state.hover_button_idx
end

local function on_mouse_pos(_, mpos)
  if not mpos or not mpos.hover or state.osd_w <= 0 or state.osd_h <= 0 then
    state.mouse_in_window = false
    if state.hover_tok_idx or state.hover_in_sub_zone or state.hover_button_idx then
      state.hover_cue_idx = nil
      state.hover_tok_idx = nil
      state.hover_in_sub_zone = false
      state.hover_button_idx = nil
      if opts.pause_on_hover and state.paused_by_hover and not state.popup and not state.menu_open then
        release_script_pause_if_owned()
      end
      update_keybindings()
      render_all()
    end
    return
  end

  state.mouse_in_window = true
  state.mouse_vx = mpos.x * (state.res_x / state.osd_w)
  state.mouse_vy = mpos.y * (state.res_y / state.osd_h)

  if state.menu_open then
    for i = 1, #state.menu_rows do
      if point_in_rect(state.mouse_vx, state.mouse_vy, state.menu_rows[i].rect) then
        if state.menu_cursor ~= i then
          state.menu_cursor = i
          render_menu()
        end
        break
      end
    end
    return
  end

  if recompute_hover_from_mouse() then
    update_keybindings()
    render_all()
  end
end

---------------------------------------------------------------------------
-- Playback time-pos, pause, end-file, shutdown observers
---------------------------------------------------------------------------
local function on_time_pos(_, pos)
  if not state.active then return end
  if type(pos) ~= "number" then return end
  if pos >= 0 then
    state.last_known_pos = pos
  end
  if state.live_fallback then return end

  local matches = find_cues_at_time(state.cues, pos)
  local new_idx = #matches > 0 and matches[#matches] or nil

  if state.pause_at_cue_end and new_idx and state.cue_end_paused_idx ~= new_idx then
    local c = state.cues[new_idx]
    if c and pos >= (c.endSeconds - 0.05) and not mp.get_property_native("pause") then
      state.cue_end_paused_idx = new_idx
      mp.set_property_native("pause", true)
    end
  end

  local ref_key = ""
  if state.ref_mode ~= "hidden" and #state.ref_cues > 0 then
    local ref_matches = find_cues_at_time(state.ref_cues, pos)
    if #ref_matches > 0 then
      ref_key = table.concat(ref_matches, ",")
    end
  end

  local cue_changed = (new_idx ~= state.current_cue_idx)
  local had_hover = (state.hover_tok_idx ~= nil or state.hover_in_sub_zone)
  if cue_changed or ref_key ~= state.current_ref_key then
    if cue_changed then
      state.current_cue_idx = new_idx
      state.cue_end_paused_idx = nil
      state.hover_cue_idx = nil
      state.hover_tok_idx = nil
    end
    state.current_ref_key = ref_key
    render_main_subtitles()
    local hover_changed = recompute_hover_from_mouse()
    if hover_changed or (cue_changed and had_hover) then
      update_keybindings()
      render_all()
    elseif cue_changed and not state.popup then
      render_popup()
    end
  end
end

local function on_pause_change(_, paused)
  local is_paused = paused == true
  if not is_paused then
    state.paused_by_script = false
    state.paused_by_hover = false
    state.paused_by_menu = false
  end

  if not state.active then return end

  if is_paused then
    accumulate_listening_now()
    state.is_playing = false
    state.play_wall_start = nil
    flush_listening_and_progress(true)
  else
    state.is_playing = true
    state.play_wall_start = mp.get_time()
  end

  if state.ref_mode == "peek" then
    render_main_subtitles()
  end
end

local function on_live_sub_text(_, val)
  if not state.active or not state.live_fallback then return end
  state.live_sub_text = trim(val or "")
  render_main_subtitles()
end

---------------------------------------------------------------------------
-- Registration (NO observers on sid / secondary-sid / track-list / file-loaded)
---------------------------------------------------------------------------
mp.add_key_binding("Ctrl+l", "open-menu", function()
  menu.toggle()
end)

mp.observe_property("osd-dimensions", "native", function()
  sync_overlay_dimensions()
end)

mp.observe_property("mouse-pos", "native", on_mouse_pos)
mp.observe_property("time-pos", "number", on_time_pos)
mp.observe_property("pause", "bool", on_pause_change)
mp.observe_property("sub-text", "string", on_live_sub_text)

mp.register_event("end-file", function()
  state.sync_seq = state.sync_seq + 1
  state.session_gen = state.session_gen + 1
  if state.menu_open then
    menu.close()
  end
  if state.active then
    stop_session(nil)
  end
end)

mp.register_event("shutdown", function()
  if state.active then
    flush_listening_and_progress(true, true)
    restore_native_subs()
  end
  set_osc_suppressed(false)
  net.cleanup_temp_files()
end)

sync_overlay_dimensions()
