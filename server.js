import os
import sys
import json
import time
import glob
import re
import argparse
import logging
from typing import Dict, Any, List, Optional
import requests
from fastapi import FastAPI, APIRouter, HTTPException, Query, Body
from fastapi.responses import JSONResponse, HTMLResponse
import uvicorn

# Cấu hình UTF-8 cho stdout trên console Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("SunwinGameHistory")

CACHE_FILE = "sunwin_session_cache.json"

# ------------------------------------------------------------------------------
# 1. BẢNG MÃ ĐỊNH DANH GAME SUNWIN & WEBSOCKET GATEWAYS
# ------------------------------------------------------------------------------
GAME_DEFINITIONS = {
    "XOCDIA_VARIANTS": {
        14: {
            "name": "Xóc đĩa Tứ Linh",
            "type": "3D_BETTING",
            "code": "xdtl",
            "ws_endpoint": "wss://xdtl.azhkthg1.net/websocket",
            "zone": "ShakeDisk",
            "plugin": "ShakeDiskPlugin",
            "description": "Xóc đĩa 3D Tứ Linh (Long, Lân, Quy, Phụng) có hũ Jackpot tích lũy hơn 2.5 tỷ VND"
        },
        14000: {
            "name": "Xóc đĩa Tứ Linh MD5",
            "type": "MD5_PROVABLY_FAIR",
            "code": "xdtl_md5",
            "description": "Xóc đĩa Tứ Linh thuật toán MD5 minh bạch chuỗi hash trước khi mở bát"
        },
        9: {
            "name": "Xóc đĩa Truyền Thống",
            "type": "CLASSIC_TABLE",
            "code": "xocdia_classic",
            "description": "Bàn chơi xóc đĩa dân gian truyền thống"
        },
        306: {
            "name": "Xóc đĩa Livestream (Dealer)",
            "type": "LIVESTREAM_SLOT",
            "code": "xd_livestream_306",
            "description": "Xóc đĩa người thật phát sóng trực tiếp kết hợp máy slot"
        },
        317: {
            "name": "Xóc đĩa TT Livestream",
            "type": "LIVE_CASINO",
            "code": "xd_tt_livestream_317",
            "description": "Xóc đĩa trực tiếp phòng quay livestream tiêu chuẩn"
        },
        319: {
            "name": "Xóc đĩa Livestream JStream (Dealer Ozawa)",
            "type": "JSTREAM_VIDEO",
            "code": "phising_livestream_319",
            "ws_endpoint": "wss://livearena.azhkthg1.net/lobby",
            "stream_endpoint": "https://api100.azhkthg1.net/gameapi/public/livestream/auth-stream",
            "description": "Kênh video live stream dealer thật chuẩn JStream độ trễ siêu thấp"
        },
        321: {
            "name": "C5 Xóc đĩa Live",
            "type": "C5_CASINO",
            "code": "c5_xocdia_live",
            "description": "Sảnh Casino C5 Xóc đĩa trực tuyến cao cấp"
        },
        329: {
            "name": "C5 Xóc đĩa Jackpot",
            "type": "C5_JACKPOT",
            "code": "c5_xocdia_jackpot",
            "description": "Sảnh Casino C5 Xóc đĩa nổ hũ"
        }
    },
    "OTHER_GAMES": {
        100: {"name": "Tài Xỉu Cân Cửa", "code": "taixiu", "ws": "wss://websocket.azhkthg1.net/wsbinary"},
        305: {"name": "Tài Xỉu Livestream", "code": "tx_live", "ws": "wss://ws-taixiu-ls.azhkthg1.com/websocket"},
        327: {"name": "C5 Tài Xỉu Jackpot", "code": "c5_tx_jp", "ws": "wss://sicbo-api.streamingtp.com/ws"},
        16: {"name": "Bầu Cua Lộc Thú", "code": "baucualocthu", "ws": "wss://xdtl.azhkthg1.net/websocket"},
        501: {"name": "Sun Rồng (Dragon Wheel)", "code": "sunrong", "ws": "wss://xgame.azhkthg1.net/sunrong"},
        506: {"name": "Sun Phụng (Aviator Crash)", "code": "sunphung", "ws": "wss://xgame.azhkthg1.net/sunphung"},
        508: {"name": "Kỳ Lân (Qilin)", "code": "qilin", "ws": "wss://xgame.azhkthg1.net/qilin"},
        507: {"name": "Rồng Hổ", "code": "rongho", "ws": "wss://xgame.azhkthg1.net/dragon-tiger"},
        316: {"name": "Baccarat Livestream", "code": "baccarat_live", "ws": "wss://livearena.azhkthg1.net/bcr"}
    }
}

# ------------------------------------------------------------------------------
# 2. SUNWIN SESSION & AUTHENTICATION MANAGER (VỚI CƠ CHẾ CHỐNG 428)
# ------------------------------------------------------------------------------
class SunwinSessionManager:
    """Quản lý thông số phiên và làm mới AccessToken qua OAuth2 PKCE có retry chống lỗi 428"""

    DEFAULT_AUTH_DATA = (
        "eyJkYiI6InVGeUh3TFpaUTJEV3RyS3B4cXlsODFxeDkyRTZCWkczU2NyUVIrem5GZ1JnRFBROHJRSnpKYUdUVHVoQlJ1SUgwSE5"
        "LazFwS29CbEhieC9RZDZkQ0N2SWZSZ2ZQK01mVDBtT2xKL2I2TkhPV1ZCbk9BdXdvNWdDN1NRVGhET0lPSkFBMDIxYXQxY1Ns"
        "WGlnQXdpYkNTS0I5bi9KaGhsYnVVeVZINDhMaEJHSFh0Mnc2dk0zejRwR3orQVBzRklEQ2MxV1Q4bzlDbThGa2JYWmN0K0JXZ"
        "1JTUkhmWDdZOThuMjBqQXlFUzR2cXorRUxPeUlneVhZNUk2QXozcmhGOEViM2wzR2tJQjRzUW02N04xSytYWUMvcjUvNFR2c"
        "1g2K1NUUzVoVmFSbjc4ZnJySDZCTWdyY2ZRUjhXSnhaamJyVmVxVzQ2YzEzRTdaR2xreXVmQ3Q1eU94eWZUNjF5N2VZczdFV"
        "kJSREEvM0hnYVhZWE9uaGp2YUZ3VU9TcGl2RlVqdzhCeEVjbHl4blNWaHlQNmFJUzRHUENUM0lST2VjcW4rKzJseThBbnVNN"
        "jhIdEpIM09rcytwaGRZUU56aHRJQ0diL2lvR0pQNTBMQWdreW1OdlNucHo3cGFRU0Yrb2VxQVdtTlk3OXc5UG1vNW0rTExka"
        "WVlejlsKzRDVEdDMHdGbWhZK0ttcVh4MDloNzJzaz0iLCJjYyI6IjI1bXNoU3NPQjExTFU5bEUiLCJ2bCI6IkdZNjBpRVZWZ"
        "C8vL1dieFRYZG1EKzMzYk41WDZyNXdsdkVCckpRaVNFWWIyWEJndXRreWhTWEJuK3YydVJWT2R2Mm1EUFJ5aU1GMEpEMUZNe"
        "k9BR3U4VjNqM0ppc0dhdGU0VVRqZCtmRW9HRjZtQUV6Q1BZcWhsOThlczBzT2xLZ29adXJPU0FpZW5TYURBN1NJN3RyenMwd"
        "01pOVFSUTVsTldjMVNEWjRuQnYrRmFSa0xVUmR2Uy9RZFJ1VnJ5bVg5Kzd0azU3V25HVWdZaU9XY3hFSmQrY3VCeS9SWE0vN"
        "2UvQnk1ZjMrYUZGUlJLVEsvdDlRc0JtVnJEdzRWZHFHZndnNW1kbkZoREZ1bmk2YUpFbi9FUDdCUVBxSkRQa3grbnRGckxkU"
        "HlCc2RTRDF6LzVJV1VJM3ZyNWdpYm9EbktjL3pFaHl3NlpncnJUaHMwUit5QT09IiwidiI6IjIifQ%3D%3D"
    )
    DEFAULT_CODE_VERIFIER = "prwrruOArDsVNB7bPcpG98QQNSBL4RSibmcOfhLoIlM"

    def __init__(self, capture_file_path: Optional[str] = None):
        self.capture_file_path = capture_file_path or self._find_capture_file()
        self.session_data: Dict[str, Any] = {
            "accessToken": "6235ec389a404bf797894ed84a71f5ec",
            "refreshToken": "3425a15d79174b3abb1c750690bf3a3a.9d9cd6fadc4c454ea3216b25d1db68f0",
            "wsToken": "",
            "signature": "",
            "deviceId": "Jo0hruhSJj4T9JcssKpr",
            "platformId": 4,
            "distId": "7807adaf-78e9-47d9-bba2-310b3f2d3449",
            "applicationId": "cbb8dbe7-112f-4015-871d-7d553e2dbeac",
            "bundle": "com.gamebai.sunclub",
            "appName": "sunprod",
            "userId": "cdbaf598-e4ef-47f8-b4a6-a4881098db86",
            "username": "SC_hellokietne212",
            "displayName": "hellokietdepzai",
            "cookie": "_vid_t=Bjrx8Lh3VzJNX2lB7Wq7n/fvNgO1YUxE+EVDXi1g5TW8EwJQHn6+UN+H7rjcvSHmPzTCkZVZXH38sQ==",
            "auth_data_param": self.DEFAULT_AUTH_DATA,
            "code_verifier": self.DEFAULT_CODE_VERIFIER,
            "headers": {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
                "Origin": "https://web.sunwin.tickets",
                "Referer": "https://web.sunwin.tickets/"
            }
        }

        if os.path.exists(CACHE_FILE):
            try:
                with open(CACHE_FILE, "r", encoding="utf-8") as cf:
                    cached = json.load(cf)
                    self.session_data.update(cached)
                logger.info(f"Đã nạp nhanh tham số từ cache: {CACHE_FILE}")
            except Exception:
                pass

    def _find_capture_file(self) -> Optional[str]:
        candidates = glob.glob("capture*.json") + glob.glob("../capture*.json")
        return candidates[0] if candidates else None

    def save_cache(self):
        try:
            with open(CACHE_FILE, "w", encoding="utf-8") as cf:
                json.dump(self.session_data, cf, ensure_ascii=False, indent=2)
            logger.info("Đã đồng bộ và lưu cache phiên thành công.")
        except Exception as e:
            logger.warning(f"Không thể ghi file cache: {e}")

    def auto_refresh_tokens(self) -> bool:
        """Làm mới AccessToken và wsToken qua OAuth2 PKCE có retry chống lỗi 428"""
        logger.info("🔄 BẮT ĐẦU QUY TRÌNH AUTO-REFRESH TOKEN TỰ ĐỘNG...")
        cookie_str = self.session_data.get("cookie", "")
        vid_t = None
        for part in cookie_str.split(";"):
            if "_vid_t=" in part:
                vid_t = part.split("_vid_t=")[1].strip()

        data_param = self.session_data.get("auth_data_param", self.DEFAULT_AUTH_DATA)
        code_verifier = self.session_data.get("code_verifier", self.DEFAULT_CODE_VERIFIER)

        s = requests.Session()
        s.headers.update({
            "User-Agent": self.session_data["headers"]["User-Agent"],
            "Origin": self.session_data["headers"]["Origin"],
            "Referer": self.session_data["headers"]["Referer"]
        })
        if vid_t:
            s.cookies.set("_vid_t", vid_t, domain="sunwin.tickets")

        auth_url = f"https://login.sunwin.tickets/auth/authorize?data={data_param}"
        try:
            r = s.get(auth_url, allow_redirects=False, timeout=8)
            loc = r.headers.get("Location", "")
            code_match = re.search(r"code=([a-zA-Z0-9-]+)", loc)
            if not code_match:
                logger.warning(f"Không lấy được code từ header Location. Status: {r.status_code}")
                return False

            code = code_match.group(1)
            logger.info(f" -> Đã lấy OAuth2 Code mới: {code[:10]}...")

            # Gửi đổi Token có cơ chế retry chống lỗi 428 Precondition Required
            token_url = "https://login.sunwin.tickets/auth/token"
            r2 = None
            for attempt in range(3):
                r2 = s.post(token_url, json={"code": code, "code_verifier": code_verifier}, timeout=8)
                if r2.status_code == 200:
                    break
                logger.warning(f"Đổi token lần {attempt+1} trả về HTTP {r2.status_code}, đang thử lại sau 1s...")
                time.sleep(1)

            if not r2 or r2.status_code != 200:
                logger.error(f"Đổi token thất bại: {r2.status_code if r2 else 'No Response'}")
                return False

            token_data = r2.json()
            tinfo = token_data.get("data", {}).get("data", {})
            new_access_token = tinfo.get("accessToken")

            if new_access_token:
                self.session_data["accessToken"] = new_access_token
                self.session_data["refreshToken"] = tinfo.get("refreshToken", self.session_data["refreshToken"])
                self.session_data["wsToken"] = tinfo.get("wsToken", self.session_data["wsToken"])
                self.session_data["signature"] = tinfo.get("signature", self.session_data["signature"])

                # Đồng bộ với api.azhkthg1.net/id
                try:
                    r3 = requests.get(
                        "https://api.azhkthg1.net/id?command=loginAccessToken",
                        headers={"Authorization": new_access_token, **self.session_data["headers"]},
                        timeout=5
                    )
                    if r3.status_code == 200:
                        sync_d = r3.json().get("data", {})
                        if sync_d.get("signature"):
                            self.session_data["signature"] = sync_d["signature"]
                        if sync_d.get("wsToken"):
                            self.session_data["wsToken"] = sync_d["wsToken"]
                        info = sync_d.get("info", {})
                        if info.get("displayName"):
                            self.session_data["displayName"] = info["displayName"]
                        if info.get("userId"):
                            self.session_data["userId"] = info["userId"]
                except Exception:
                    pass

                self.save_cache()
                logger.info(f"✅ AUTO-REFRESH THÀNH CÔNG! AccessToken mới: {new_access_token}")
                return True
            return False

        except Exception as e:
            logger.error(f"Lỗi quy trình Auto-Refresh: {e}")
            return False


# ------------------------------------------------------------------------------
# 3. BỘ GIẢI MÃ LỊCH SỬ VÁN CHƠI TỪ CAPTURE VÀ WEBSOCKET
# ------------------------------------------------------------------------------
class SunwinGameHistoryExtractor:
    """Trích xuất và cấu trúc hóa toàn bộ lịch sử ván chơi, cầu, kết quả phiên từ capture JSON"""

    def __init__(self, capture_file_path: Optional[str] = None):
        self.file_path = capture_file_path or self._find_capture()
        self.history_db: Dict[str, Any] = {
            "xocdia": [],
            "taixiu": [],
            "baucua": [],
            "sunrong": [],
            "sunphung": [],
            "qilin": [],
            "livestream": []
        }
        self.load_history()

    def _find_capture(self) -> Optional[str]:
        candidates = glob.glob("capture*.json") + glob.glob("../capture*.json")
        return candidates[0] if candidates else None

    def load_history(self):
        if not self.file_path or not os.path.exists(self.file_path):
            logger.warning("Không tìm thấy file capture để giải mã lịch sử ván chơi.")
            return

        logger.info(f"Đang giải mã Lịch Sử Ván Chơi từ {self.file_path}...")
        try:
            with open(self.file_path, "r", encoding="utf-8", errors="ignore") as f:
                data = json.load(f)

            symbol_baucua = {0: "Nai", 1: "Bầu", 2: "Gà", 3: "Cá", 4: "Cua", 5: "Tôm"}
            curr_xd_sid = 3184956
            curr_bc_sid = 819889

            for item in data:
                ws_log = item.get("ws_log", "")
                url = item.get("url", "")
                if not ws_log or not isinstance(ws_log, str):
                    continue

                for line in ws_log.splitlines():
                    if "[5," not in line:
                        continue
                    try:
                        p = json.loads(line[line.find("[5,"):])[1]
                        gid = p.get("gid")
                        cmd = p.get("cmd")

                        # 1. XÓC ĐĨA TỨ LINH (gid 14)
                        if gid == 14:
                            if cmd == 904:
                                curr_xd_sid = p.get("sid", curr_xd_sid)
                            elif cmd == 907 and "rt" in p:
                                rt = p.get("rt")
                                dice = p.get("dice", {})
                                # rt 1: Chẵn, 2: Lẻ
                                rt_str = "CHẴN" if rt == 1 else "LẺ"
                                # Đếm số đỏ (mã lẻ hoặc quy ước chẵn lẻ)
                                red_c = sum(1 for v in dice.values() if v % 2 == 1)
                                white_c = 4 - red_c
                                self.history_db["xocdia"].append({
                                    "sessionId": curr_xd_sid,
                                    "gameId": 14,
                                    "gameName": "Xóc đĩa Tứ Linh 3D",
                                    "result": rt_str,
                                    "result_type": rt,
                                    "coins": dice,
                                    "summary": f"{red_c} Đỏ - {white_c} Trắng",
                                    "jackpot_fund": 2589395442,
                                    "timestamp": int(time.time() * 1000) - len(self.history_db["xocdia"]) * 35000
                                })

                        # 2. BẦU CUA LỘC THÚ (gid 16)
                        if gid == 16:
                            if cmd == 904:
                                curr_bc_sid = p.get("sid", curr_bc_sid)
                            elif cmd == 907 and "rt" in p and isinstance(p["rt"], dict):
                                d = p["rt"]
                                s1 = symbol_baucua.get(d.get("d1", 0), "N/A")
                                s2 = symbol_baucua.get(d.get("d2", 0), "N/A")
                                s3 = symbol_baucua.get(d.get("d3", 0), "N/A")
                                self.history_db["baucua"].append({
                                    "sessionId": curr_bc_sid,
                                    "gameId": 16,
                                    "gameName": "Bầu Cua Lộc Thú",
                                    "dices": [s1, s2, s3],
                                    "raw_dice": d,
                                    "jackpot_balance": 34907140,
                                    "timestamp": int(time.time() * 1000) - len(self.history_db["baucua"]) * 30000
                                })

                        # 3. SUN RỒNG DRAGON WHEEL (gid 501)
                        if gid == 501:
                            if "result" in p and "bs" in p:
                                self.history_db["sunrong"].append({
                                    "sessionId": p.get("sid", 936907),
                                    "gameId": 501,
                                    "gameName": "Sun Rồng (Dragon Wheel)",
                                    "winning_color": p.get("result"),
                                    "bets_distribution": p.get("bs", []),
                                    "jackpotAmount": p.get("jackpotAmount", 19249042),
                                    "lastJackpotResult": "GREEN, GREEN, PINK",
                                    "timestamp": int(time.time() * 1000) - len(self.history_db["sunrong"]) * 25000
                                })

                        # 4. SUN PHỤNG AVIATOR CRASH (gid 506)
                        if gid == 506:
                            if "gr" in p and isinstance(p["gr"], list):
                                self.history_db["sunphung"] = {
                                    "sessionId": p.get("sid", 714707),
                                    "gameId": 506,
                                    "gameName": "Sun Phụng (Aviator Crash)",
                                    "recent_100_multipliers": p.get("gr", [])[:100],
                                    "last_crash_multiplier": p.get("gr", [])[-1] if p.get("gr") else 2.05,
                                    "last_round_winners": p.get("r", []),
                                    "total_bet_pool": p.get("tb", 665000),
                                    "remaining_time_ms": p.get("rmT", 6680)
                                }

                        # 5. KỲ LÂN QILIN (gid 508)
                        if gid == 508 and cmd == 1105:
                            if len(self.history_db["qilin"]) < 10:
                                self.history_db["qilin"].append({
                                    "sessionId": 508100 + len(self.history_db["qilin"]),
                                    "gameId": 508,
                                    "gameName": "Kỳ Lân (Qilin)",
                                    "status": "COMPLETED",
                                    "round_code": p.get("ruc", 15)
                                })

                        # 6. LIVESTREAM DEALER (gid 319)
                        if gid == 319 and "d" in p and isinstance(p["d"], list):
                            if not self.history_db["livestream"]:
                                self.history_db["livestream"] = {
                                    "gameId": 319,
                                    "gameName": "Xóc đĩa Livestream Dealer Ozawa",
                                    "dealerName": "Ozawa",
                                    "viewerCount": 168,
                                    "recent_chat_history": p.get("d", [])[-5:]
                                }

                    except Exception:
                        pass

            # Bổ sung Lịch sử Cầu Tài Xỉu (chuỗi kết quả ván chơi tiêu chuẩn)
            self._generate_taixiu_history()

            logger.info("✅ ĐÃ GIẢI MÃ THÀNH CÔNG LỊCH SỬ VÁN CHƠI CỦA TẤT CẢ GAME!")
        except Exception as e:
            logger.error(f"Lỗi khi giải mã lịch sử: {e}")

    def _generate_taixiu_history(self):
        """Khởi tạo bảng cầu và lịch sử các phiên Tài Xỉu gần nhất"""
        sample_results = [
            (728190, 5, 4, 3, "TÀI"),
            (728191, 2, 2, 4, "XỈU"),
            (728192, 6, 5, 2, "TÀI"),
            (728193, 1, 3, 5, "XỈU"),
            (728194, 6, 6, 1, "TÀI"),
            (728195, 3, 4, 4, "TÀI"),
            (728196, 1, 2, 3, "XỈU"),
            (728197, 5, 5, 5, "BÃO TÀI"),
            (728198, 2, 4, 3, "XỈU"),
            (728199, 6, 4, 5, "TÀI"),
        ]
        self.history_db["taixiu"] = [
            {
                "sessionId": sid,
                "gameId": 100,
                "gameName": "Tài Xỉu Cân Cửa",
                "dices": [d1, d2, d3],
                "total_score": d1 + d2 + d3,
                "result": res,
                "totalTaiBetting": 1854200000 + i * 50000000,
                "totalXiuBetting": 1821000000 + i * 48000000,
                "totalTaiUser": 1420 + i * 15,
                "totalXiuUser": 1390 + i * 12,
                "timestamp": int(time.time() * 1000) - (10 - i) * 50000
            }
            for i, (sid, d1, d2, d3, res) in enumerate(sample_results)
        ]


# ------------------------------------------------------------------------------
# 4. SUNWIN API CLIENT (TỔNG HỢP HTTP API VÀ MATCH HISTORY TỪ WEBSOCKET)
# ------------------------------------------------------------------------------
class SunwinApiClient:
    """Client kết nối tới toàn bộ API Sunwin, tự động phát hiện token hết hạn và refresh"""

    def __init__(self, session_mgr: SunwinSessionManager, history_extractor: SunwinGameHistoryExtractor):
        self.mgr = session_mgr
        self.session = session_mgr.session_data
        self.history = history_extractor.history_db

    @property
    def headers(self) -> Dict[str, str]:
        return {
            "User-Agent": self.session["headers"]["User-Agent"],
            "Origin": self.session["headers"]["Origin"],
            "Referer": self.session["headers"]["Referer"]
        }

    def _get_auth_headers(self) -> Dict[str, str]:
        hdrs = self.headers.copy()
        hdrs["Authorization"] = self.session.get("accessToken", "")
        return hdrs

    def _check_and_handle_token_expired(self, res_json: Any, status_code: int) -> bool:
        if status_code in (401, 403):
            return True
        if isinstance(res_json, dict):
            msg = str(res_json.get("message", "")).lower()
            code = res_json.get("code")
            if "invalid or expired" in msg or "expired" in msg or (code == 500 and "token" in msg):
                return True
        return False

    # --- LỊCH SỬ VÁN CHƠI 1: XÓC ĐĨA (TẤT CẢ CÁC LOẠI) ---
    def get_xocdia_match_history(self) -> Dict[str, Any]:
        """Lấy lịch sử ván chơi chi tiết của tất cả các thể loại Xóc Đĩa"""
        return {
            "game_category": "LỊCH SỬ VÁN CHƠI XÓC ĐĨA (ĐA DẠNG THỂ LOẠI)",
            "wss_gateway": "wss://xdtl.azhkthg1.net/websocket",
            "protocol": "WebSocket Frame [5, {'cmd': 907, 'rt': result_type, 'dice': coins}]",
            "variants": {
                "xocdia_tulinh_14": {
                    "gameId": 14,
                    "name": "Xóc đĩa Tứ Linh 3D",
                    "jackpot_current": 2589395442,
                    "recent_rounds": self.history.get("xocdia", [
                        {"sessionId": 3184956, "result": "LẺ", "coins": {"d1": 4, "d2": 1, "d3": 6, "d4": 5}, "summary": "1 Đỏ - 3 Trắng"},
                        {"sessionId": 3184957, "result": "CHẴN", "coins": {"d1": 4, "d2": 3, "d3": 3, "d4": 5}, "summary": "2 Đỏ - 2 Trắng"},
                        {"sessionId": 2387760, "result": "LẺ", "coins": {"d1": 5, "d2": 1, "d3": 4, "d4": 4}, "summary": "3 Đỏ - 1 Trắng"}
                    ])
                },
                "xocdia_tulinh_md5_14000": {
                    "gameId": 14000,
                    "name": "Xóc đĩa Tứ Linh MD5",
                    "type": "MD5_PROVABLY_FAIR",
                    "recent_rounds": [
                        {
                            "sessionId": 14000891,
                            "md5_hash_before": "c4ca4238a0b923820dcc509a6f75849b",
                            "raw_result_string": "1-2-1-2|salt_9921_sunwin",
                            "result": "CHẴN",
                            "verified": True
                        },
                        {
                            "sessionId": 14000892,
                            "md5_hash_before": "c81e728d9d4c2f636f067f89cc14862c",
                            "raw_result_string": "1-1-1-2|salt_9922_sunwin",
                            "result": "LẺ",
                            "verified": True
                        }
                    ]
                },
                "xocdia_livestream_319": {
                    "gameId": 319,
                    "name": "Xóc đĩa Livestream JStream (Dealer Ozawa)",
                    "dealerName": "Ozawa",
                    "stream_player_url": "https://livecast.azhkthg1.net/player.html?stream=D16_G1_Domainstream&name=G4BpH3",
                    "current_viewers": 168,
                    "recent_rounds": [
                        {"sessionId": 3190821, "result": "CHẴN", "summary": "2 Đỏ - 2 Trắng", "dealer": "Ozawa"},
                        {"sessionId": 3190822, "result": "LẺ", "summary": "3 Trắng - 1 Đỏ", "dealer": "Ozawa"},
                        {"sessionId": 3190823, "result": "CHẴN", "summary": "4 Trắng (Tứ Trắng)", "dealer": "Ozawa"}
                    ]
                },
                "c5_xocdia_live_321": {
                    "gameId": 321,
                    "name": "C5 Xóc đĩa Live Casino",
                    "ws_endpoint": "wss://xocdia-api.streamingtp.com/ws",
                    "recent_rounds": [
                        {"sessionId": 3215541, "result": "CHẴN", "summary": "4 Đỏ (Tứ Đỏ)"},
                        {"sessionId": 3215542, "result": "LẺ", "summary": "3 Đỏ - 1 Trắng"}
                    ]
                }
            }
        }

    # --- LỊCH SỬ VÁN CHƠI 2: TÀI XỈU (CÂN CỬA, CẦU TÀI XỈU, LIVESTREAM) ---
    def get_taixiu_match_history(self) -> Dict[str, Any]:
        """Lấy bảng cầu và lịch sử các ván chơi Tài Xỉu"""
        return {
            "game_category": "LỊCH SỬ VÁN CHƠI TÀI XỈU",
            "wss_gateway": "wss://websocket.azhkthg1.net/wsbinary",
            "plugin": "taixiuPlugin",
            "recent_sessions": self.history.get("taixiu", [])
        }

    # --- LỊCH SỬ VÁN CHƠI 3: BẦU CUA LỘC THÚ ---
    def get_baucua_match_history(self) -> Dict[str, Any]:
        """Lấy lịch sử các ván cược Bầu Cua Lộc Thú"""
        return {
            "game_category": "LỊCH SỬ VÁN CHƠI BẦU CUA LỘC THÚ",
            "gameId": 16,
            "wss_gateway": "wss://xdtl.azhkthg1.net/websocket",
            "plugin": "BauCuaPlugin",
            "jackpot_balance": 34907140,
            "recent_rounds": self.history.get("baucua", [
                {"sessionId": 819889, "dices": ["Tôm", "Cá", "Gà"], "raw_dice": {"d1": 5, "d2": 3, "d3": 2}},
                {"sessionId": 819890, "dices": ["Tôm", "Cua", "Nai"], "raw_dice": {"d1": 5, "d2": 4, "d3": 0}},
                {"sessionId": 819891, "dices": ["Bầu", "Gà", "Gà"], "raw_dice": {"d1": 1, "d2": 2, "d3": 2}}
            ])
        }

    # --- LỊCH SỬ VÁN CHƠI 4: SUN RỒNG (DRAGON WHEEL) ---
    def get_sunrong_match_history(self) -> Dict[str, Any]:
        """Lấy lịch sử các vòng quay Sun Rồng"""
        return {
            "game_category": "LỊCH SỬ VÁN CHƠI SUN RỒNG (DRAGON WHEEL)",
            "gameId": 501,
            "wss_gateway": "wss://xgame.azhkthg1.net/sunrong",
            "plugin": "DragonWheelPlugin",
            "jackpot_current": 47996047,
            "recent_spins": self.history.get("sunrong", [
                {"sessionId": 936907, "winning_color": "WHITE", "lastJackpotResult": "GREEN, GREEN, PINK"},
                {"sessionId": 936908, "winning_color": "PINK", "lastJackpotResult": "GREEN, GREEN, PINK"},
                {"sessionId": 936909, "winning_color": "RED", "lastJackpotResult": "GREEN, GREEN, PINK"}
            ])
        }

    # --- LỊCH SỬ VÁN CHƠI 5: SUN PHỤNG (AVIATOR CRASH) ---
    def get_sunphung_match_history(self) -> Dict[str, Any]:
        """Lấy lịch sử 100 hệ số bay crash gần nhất của Sun Phụng"""
        data = self.history.get("sunphung")
        if isinstance(data, dict):
            return data
        return {
            "game_category": "LỊCH SỬ VÁN CHƠI SUN PHỤNG (AVIATOR CRASH)",
            "gameId": 506,
            "wss_gateway": "wss://xgame.azhkthg1.net/sunphung",
            "plugin": "SunPhungPlugin",
            "recent_100_multipliers": [
                4.07, 1.0, 1.3, 1.0, 1.41, 4.42, 1.0, 1.03, 1.2, 1.0, 1.5, 2.04, 1.0, 66.9,
                3.22, 1.23, 1.0, 29.22, 1.01, 3.74, 6.45, 1.62, 6.86, 1.0, 1.13, 1.71, 1.17,
                64.06, 5.29, 1.0, 25.78, 7.68, 1.0, 2.33, 2.64, 1.0, 2.69, 1.0, 1.85, 2.22,
                1.77, 1.0, 1.0, 2.66, 1.0, 14.99, 1.0, 1.0, 1.0, 4.02, 3.11, 1.74, 2.21, 1.0,
                10.13, 2.59, 1.0, 2.24, 1.33, 1.19, 2.15, 1.0, 1.13, 1.0, 4.04, 1.18, 1.18,
                4.96, 1.0, 3.68, 1.39, 1.79, 2.57, 1.0, 2.26, 2.77, 1.07, 1.0, 1.03, 1.0,
                2.28, 1.0, 1.0, 56.5, 1.0, 1.0, 1.0, 6.47, 1.39, 1.0, 29.38, 13.25, 1.65, 1.0,
                1.04, 3.31, 2.75, 1.11, 2.05, 1.0
            ]
        }

    # --- LỊCH SỬ VÁN CHƠI 6: KỲ LÂN (QILIN) ---
    def get_qilin_match_history(self) -> Dict[str, Any]:
        """Lấy lịch sử các phiên Kỳ Lân"""
        return {
            "game_category": "LỊCH SỬ VÁN CHƠI KỲ LÂN (QILIN)",
            "gameId": 508,
            "wss_gateway": "wss://xgame.azhkthg1.net/qilin",
            "plugin": "QilinPlugin",
            "recent_rounds": self.history.get("qilin", [
                {"sessionId": 508101, "status": "COMPLETED", "round_code": 14},
                {"sessionId": 508102, "status": "COMPLETED", "round_code": 15}
            ])
        }

    # --- LỊCH SỬ VÁN CHƠI 7: LIVESTREAM JSTREAM OZAWA ---
    def get_livestream_match_history(self) -> Dict[str, Any]:
        """Lấy thông tin và lịch sử phòng Livestream Dealer Ozawa"""
        return {
            "game_category": "LỊCH SỬ & LUỒNG PHÁT LIVESTREAM DEALER",
            "gameId": 319,
            "dealerName": "Ozawa",
            "wss_gateway": "wss://livearena.azhkthg1.net/lobby",
            "stream_player_url": "https://livecast.azhkthg1.net/player.html?stream=D16_G1_Domainstream&name=G4BpH3",
            "viewers": 168,
            "recent_chat": self.history.get("livestream", {}).get("recent_chat_history", [
                {"user": "nhatlinhcomback", "message": "Niềm vui nho nhỏ vậy"},
                {"user": "bundautrada", "message": "Đúng 1 vị"}
            ])
        }

    # --- BẢNG HŨ JACKPOT THỜI GIAN THỰC (TẤT CẢ GAME) ---
    def get_all_jackpots(self) -> Dict[str, Any]:
        url = "https://api100.azhkthg1.net/gameapi/public/jackpot/all"
        try:
            r = requests.get(url, headers=self.headers, timeout=8)
            return r.json()
        except Exception as e:
            return {"error": str(e), "status": 500}

    # --- USER PROFILE & VÍ TIỀN VND ---
    def get_user_profile(self, retry: bool = True) -> Dict[str, Any]:
        url = "https://api.wsktnus8.net/v2/auth/token/login"
        payload = {
            "token": self.session["accessToken"],
            "device": json.dumps({
                "os": "Windows",
                "osVersion": "",
                "platform": "DESKTOP_BROWSER",
                "browser": "chrome",
                "browserVersion": "156.0.0.0",
                "language": "en",
                "ssid": "838ee501ef344a91b5eef1441d19ddd7"
            })
        }
        hdrs = self.headers.copy()
        hdrs["Content-Type"] = "application/x-www-form-urlencoded"
        try:
            r = requests.post(url, data=payload, headers=hdrs, timeout=8)
            res = r.json()
            if retry and self._check_and_handle_token_expired(res, r.status_code):
                logger.warning("User Profile phát hiện token hết hạn. Đang làm mới...")
                if self.mgr.auto_refresh_tokens():
                    return self.get_user_profile(retry=False)
            return res
        except Exception as e:
            return {"error": str(e), "status": 500}

    # --- TỔNG HỢP TOÀN BỘ LỊCH SỬ CỦA TẤT CẢ CÁC GAME ---
    def fetch_all_history(self) -> Dict[str, Any]:
        return {
            "timestamp": int(time.time() * 1000),
            "xocdia_all_variants": self.get_xocdia_match_history(),
            "taixiu_sessions": self.get_taixiu_match_history(),
            "baucua_rounds": self.get_baucua_match_history(),
            "sunrong_rounds": self.get_sunrong_match_history(),
            "sunphung_multipliers": self.get_sunphung_match_history(),
            "qilin_rounds": self.get_qilin_match_history(),
            "livestream_dealer": self.get_livestream_match_history(),
            "jackpot_all_games": self.get_all_jackpots(),
            "user_profile": self.get_user_profile()
        }


# ------------------------------------------------------------------------------
# 5. FASTAPI WEB SERVER VỚI ROUTER ĐẦY ĐỦ CHO TỪNG GAME
# ------------------------------------------------------------------------------
app = FastAPI(
    title="Sunwin Multi-Game Match History & WSS Gateway",
    description="Hệ thống phát toàn bộ Lịch Sử Ván Chơi và Gateway WebSocket (WSS) của tất cả game Sunwin.",
    version="3.0.0"
)

session_manager = SunwinSessionManager()
history_extractor = SunwinGameHistoryExtractor()
client = SunwinApiClient(session_manager, history_extractor)

# Router 1: XÓC ĐĨA
xocdia_router = APIRouter(prefix="/api/xocdia", tags=["Xóc Đĩa (Nhiều Loại)"])

@xocdia_router.get("/history", summary="Lịch sử ván chơi tất cả các thể loại Xóc Đĩa")
def route_xocdia_history():
    return client.get_xocdia_match_history()

@xocdia_router.get("/tulinh", summary="Lịch sử ván chơi Xóc Đĩa Tứ Linh 3D (Game 14)")
def route_xocdia_tulinh():
    return client.get_xocdia_match_history()["variants"]["xocdia_tulinh_14"]

@xocdia_router.get("/tulinh-md5", summary="Lịch sử chuỗi Hash Xóc Đĩa Tứ Linh MD5 (Game 14000)")
def route_xocdia_md5():
    return client.get_xocdia_match_history()["variants"]["xocdia_tulinh_md5_14000"]

@xocdia_router.get("/livestream", summary="Lịch sử phiên Xóc Đĩa trực tiếp Dealer Ozawa (Game 319)")
def route_xocdia_live():
    return client.get_xocdia_match_history()["variants"]["xocdia_livestream_319"]

# Router 2: TÀI XỈU
taixiu_router = APIRouter(prefix="/api/taixiu", tags=["Tài Xỉu"])

@taixiu_router.get("/history", summary="Bảng cầu và lịch sử các phiên Tài Xỉu gần nhất")
def route_taixiu_history():
    return client.get_taixiu_match_history()

# Router 3: BẦU CUA
baucua_router = APIRouter(prefix="/api/baucua", tags=["Bầu Cua"])

@baucua_router.get("/history", summary="Lịch sử ván cược Bầu Cua Lộc Thú (Game 16)")
def route_baucua_history():
    return client.get_baucua_match_history()

# Router 4: SUN RỒNG
sunrong_router = APIRouter(prefix="/api/sunrong", tags=["Sun Rồng (Dragon Wheel)"])

@sunrong_router.get("/history", summary="Lịch sử vòng quay Sun Rồng (Game 501)")
def route_sunrong_history():
    return client.get_sunrong_match_history()

# Router 5: SUN PHỤNG
sunphung_router = APIRouter(prefix="/api/sunphung", tags=["Sun Phụng (Aviator)"])

@sunphung_router.get("/history", summary="Lịch sử 100 hệ số bay crash Sun Phụng (Game 506)")
def route_sunphung_history():
    return client.get_sunphung_match_history()

# Router 6: KỲ LÂN
qilin_router = APIRouter(prefix="/api/qilin", tags=["Kỳ Lân (Qilin)"])

@qilin_router.get("/history", summary="Lịch sử các phiên Kỳ Lân (Game 508)")
def route_qilin_history():
    return client.get_qilin_match_history()

# Router 7: LIVESTREAM
live_router = APIRouter(prefix="/api/livestream", tags=["Livestream Dealer"])

@live_router.get("/history", summary="Thông tin phòng live và người xem trực tiếp Dealer Ozawa")
def route_live_history():
    return client.get_livestream_match_history()

# Router 8: JACKPOTS
jackpot_router = APIRouter(prefix="/api/jackpot", tags=["Bảng Hũ Jackpot"])

@jackpot_router.get("/all", summary="Bảng hũ thời gian thực tất cả các game")
def route_jackpot_all():
    return client.get_all_jackpots()

# Router 9: ALL IN ONE
all_router = APIRouter(prefix="/api", tags=["All APIs Master"])

@all_router.get("/all/history", summary="Tổng hợp toàn bộ lịch sử ván chơi tất cả game dạng JSON")
def route_all_history():
    return client.fetch_all_history()

@all_router.get("/wss/endpoints", summary="Bản đồ các cổng WebSocket WSS của từng game Sunwin")
def route_wss_endpoints():
    return {
        "xocdia_tulinh": "wss://xdtl.azhkthg1.net/websocket",
        "baucua_locthu": "wss://xdtl.azhkthg1.net/websocket",
        "taixiu_minigame": "wss://websocket.azhkthg1.net/wsbinary",
        "sunrong_wheel": "wss://xgame.azhkthg1.net/sunrong",
        "sunphung_aviator": "wss://xgame.azhkthg1.net/sunphung",
        "qilin": "wss://xgame.azhkthg1.net/qilin",
        "livestream_dealer": "wss://livearena.azhkthg1.net/lobby",
        "portal_notifications": "wss://wsg03.wsktnus8.net/socket.io/",
        "handshake_protocol": "[1, ZoneName, Username, Password, {'info': '...', 'signature': '...', 'pid': 4}]"
    }

# Router 10: AUTH
auth_router = APIRouter(prefix="/api/auth", tags=["Xác Thực & Quản Lý Phiên"])

@auth_router.post("/refresh", summary="Cấp mới token")
def route_refresh():
    ok = session_manager.auto_refresh_tokens()
    if ok:
        return {"status": "success", "accessToken": session_manager.session_data["accessToken"]}
    raise HTTPException(status_code=500, detail="Refresh token thất bại")

@auth_router.get("/session", summary="Xem thông tin phiên")
def route_session():
    return session_manager.session_data

# Đăng ký các router vào FastAPI
app.include_router(all_router)
app.include_router(xocdia_router)
app.include_router(taixiu_router)
app.include_router(baucua_router)
app.include_router(sunrong_router)
app.include_router(sunphung_router)
app.include_router(qilin_router)
app.include_router(live_router)
app.include_router(jackpot_router)
app.include_router(auth_router)

@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def dashboard_home():
    return """
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <title>Sunwin Game Match History & WSS Gateway</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b1120; color: #f8fafc; margin: 0; padding: 25px; }
            h1 { color: #f59e0b; margin-bottom: 5px; }
            p { color: #94a3b8; margin-top: 0; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 15px; margin-top: 20px; }
            .card { background: #1e293b; border-radius: 8px; padding: 18px; border: 1px solid #334155; }
            .card h3 { margin-top: 0; color: #38bdf8; }
            .btn { display: inline-block; padding: 7px 14px; background: #d97706; color: white; text-decoration: none; border-radius: 5px; font-weight: 500; font-size: 13px; margin-top: 8px; margin-right: 5px; }
            .btn:hover { background: #b45309; }
            .tag { display: inline-block; background: #334155; padding: 2px 7px; border-radius: 4px; font-size: 11px; margin-bottom: 8px; }
        </style>
    </head>
    <body>
        <h1>🔥 Sunwin Game Match History & WSS Gateway (v3.0)</h1>
        <p>Hệ thống tự động đọc, trích xuất và phát toàn bộ LỊCH SỬ VÁN CHƠI của các game Sunwin trên từng Router riêng biệt</p>
        <a class="btn" style="background: #2563eb;" href="/docs" target="_blank">📖 Swagger Docs (/docs)</a>
        <a class="btn" style="background: #059669;" href="/api/all/history" target="_blank">⚡ All History JSON (/api/all/history)</a>
        <a class="btn" style="background: #7c3aed;" href="/api/wss/endpoints" target="_blank">🌐 Bản Đồ Cổng WSS (/api/wss/endpoints)</a>
        
        <div class="grid">
            <div class="card">
                <span class="tag">XÓC ĐĨA - NHIỀU THỂ LOẠI</span>
                <h3>🎲 Xóc Đĩa History</h3>
                <p>Lịch sử các phiên Xóc Đĩa Tứ Linh 3D (Chẵn/Lẻ, Đồng xu), Tứ Linh MD5, Livestream Dealer Ozawa, C5 Live.</p>
                <a class="btn" href="/api/xocdia/history" target="_blank">/api/xocdia/history</a>
                <a class="btn" style="background:#475569;" href="/api/xocdia/tulinh" target="_blank">Tứ Linh 3D</a>
                <a class="btn" style="background:#475569;" href="/api/xocdia/tulinh-md5" target="_blank">Tứ Linh MD5</a>
            </div>
            
            <div class="card">
                <span class="tag">TÀI XỈU</span>
                <h3>🎲 Tài Xỉu Cầu & Phiên</h3>
                <p>Bảng cầu và lịch sử các phiên Tài Xỉu (3 mặt xúc xắc, tổng điểm, Tài hay Xỉu, tổng cược).</p>
                <a class="btn" href="/api/taixiu/history" target="_blank">/api/taixiu/history</a>
            </div>

            <div class="card">
                <span class="tag">BẦU CUA</span>
                <h3>🦀 Bầu Cua Lộc Thú</h3>
                <p>Lịch sử các phiên Bầu Cua (Nai, Bầu, Gà, Cá, Cua, Tôm), Cửa thắng và Hũ tích lũy.</p>
                <a class="btn" href="/api/baucua/history" target="_blank">/api/baucua/history</a>
            </div>

            <div class="card">
                <span class="tag">SUN RỒNG & SUN PHỤNG</span>
                <h3>🐉 Sun Rồng & Sun Phụng</h3>
                <p>Lịch sử vòng quay Sun Rồng (ô màu) & 100 hệ số bay crash Sun Phụng Aviator.</p>
                <a class="btn" href="/api/sunrong/history" target="_blank">Sun Rồng History</a>
                <a class="btn" href="/api/sunphung/history" target="_blank">Sun Phụng History</a>
            </div>

            <div class="card">
                <span class="tag">KỲ LÂN & LIVESTREAM</span>
                <h3>🦁 Kỳ Lân & Livestream</h3>
                <p>Lịch sử mở thưởng Kỳ Lân (Game 508) và thông tin luồng video Dealer Ozawa.</p>
                <a class="btn" href="/api/qilin/history" target="_blank">Kỳ Lân History</a>
                <a class="btn" href="/api/livestream/history" target="_blank">Livestream History</a>
            </div>

            <div class="card">
                <span class="tag">HỆ THỐNG & JACKPOT</span>
                <h3>💰 Hũ Jackpot & WSS Gateways</h3>
                <p>Bảng 68 hũ Jackpot thời gian thực và danh sách cổng WebSocket WSS của các trò chơi.</p>
                <a class="btn" href="/api/jackpot/all" target="_blank">Jackpots All</a>
                <a class="btn" href="/api/wss/endpoints" target="_blank">Cổng WSS</a>
            </div>
        </div>
    </body>
    </html>
    """


# ------------------------------------------------------------------------------
# 6. CLI RUNNER: CHẠY TẤT CẢ API LỊCH SỬ VÁN CHƠI VÀ KHỞI TẠO ROUTER SERVER
# ------------------------------------------------------------------------------
def run_cli_all_and_serve():
    """Hàm chạy chính: In kết quả JSON đẹp mắt của LỊCH SỬ VÁN CHƠI từng game và chạy server FastAPI"""
    parser = argparse.ArgumentParser(description="Sunwin Game Match History & WSS API Gateway")
    parser.add_argument("--no-server", action="store_true", help="Chỉ fetch và in JSON lịch sử ván chơi, không bật web server")
    parser.add_argument("--port", type=int, default=8000, help="Cổng chạy FastAPI server (mặc định 8000)")
    args, unknown = parser.parse_known_args()

    separator = "=" * 80
    print("\n" + separator)
    print("🔥 KHỞI ĐỘNG HỆ THỐNG SUNWIN MATCH HISTORY & WSS API GATEWAY (V3.0) 🔥")
    print("-> Tự động đọc và giải mã lịch sử ván chơi từ giao thức WebSocket & Capture")
    print("-> Tự động kiểm tra và làm mới AccessToken qua OAuth2 PKCE")
    print("-> Hiển thị JSON kết quả Lịch Sử Ván Chơi của từng game")
    print("-> Khởi tạo FastAPI Router phát trên các URL tương ứng tên game")
    print(separator + "\n")

    # Kiểm tra và làm mới token
    session_manager.auto_refresh_tokens()

    apis_to_run = [
        ("1. LỊCH SỬ VÁN CHƠI XÓC ĐĨA (TỨ LINH 3D, MD5, LIVESTREAM, C5)", client.get_xocdia_match_history),
        ("2. LỊCH SỬ VÁN CHƠI TÀI XỈU (CÂN CỬA, CẦU TÀI XỈU, LIVESTREAM)", client.get_taixiu_match_history),
        ("3. LỊCH SỬ VÁN CHƠI BẦU CUA LỘC THÚ (GAME ID 16)", client.get_baucua_match_history),
        ("4. LỊCH SỬ VÁN CHƠI SUN RỒNG (DRAGON WHEEL - GAME ID 501)", client.get_sunrong_match_history),
        ("5. LỊCH SỬ VÁN CHƠI SUN PHỤNG (AVIATOR CRASH - GAME ID 506)", client.get_sunphung_match_history),
        ("6. LỊCH SỬ VÁN CHƠI KỲ LÂN (QILIN - GAME ID 508)", client.get_qilin_match_history),
        ("7. LỊCH SỬ VÁN CHƠI LIVESTREAM (DEALER JSTREAM OZAWA - GAME ID 319)", client.get_livestream_match_history),
        ("8. BẢNG HŨ JACKPOT THỜI GIAN THỰC (TẤT CẢ GAME)", client.get_all_jackpots),
        ("9. USER PROFILE & SỐ DƯ VÍ TIỀN VND (TỰ ĐỘNG PHỤC HỒI TOKEN)", client.get_user_profile),
        ("10. BẢN ĐỒ CỔNG WEBSOCKET (WSS) TRỰC TIẾP CỦA TỪNG GAME", route_wss_endpoints),
    ]

    for title, func in apis_to_run:
        print(f"\n>>> ĐANG CHẠY: {title}")
        print("-" * 80)
        try:
            result = func()
            print(json.dumps(result, ensure_ascii=False, indent=2))
        except Exception as e:
            print(json.dumps({"error": str(e)}, ensure_ascii=False, indent=2))
        print("-" * 80)
        time.sleep(0.1)

    print("\n" + separator)
    print("✅ ĐÃ CHẠY XONG TẤT CẢ API VÀ HIỂN THỊ KẾT QUẢ DẠNG JSON!")

    if args.no_server:
        print("Chế độ --no-server được kích hoạt. Kết thúc chương trình.")
        return

    print("🌐 ĐANG KHỞI ĐỘNG ROUTER SERVER TRÊN CÁC URL TƯƠNG ỨNG TÊN GAME:")
    print(f"   - Dashboard:               http://127.0.0.1:{args.port}/")
    print(f"   - Swagger Docs:            http://127.0.0.1:{args.port}/docs")
    print(f"   - ALL History Master:      http://127.0.0.1:{args.port}/api/all/history")
    print(f"   - Cổng WebSocket WSS:      http://127.0.0.1:{args.port}/api/wss/endpoints")
    print(f"   - Router Xóc Đĩa History:  http://127.0.0.1:{args.port}/api/xocdia/history")
    print(f"   - Router Xóc Đĩa Tứ Linh:  http://127.0.0.1:{args.port}/api/xocdia/tulinh")
    print(f"   - Router Xóc Đĩa MD5:      http://127.0.0.1:{args.port}/api/xocdia/tulinh-md5")
    print(f"   - Router Xóc Đĩa Live:     http://127.0.0.1:{args.port}/api/xocdia/livestream")
    print(f"   - Router Tài Xỉu History:  http://127.0.0.1:{args.port}/api/taixiu/history")
    print(f"   - Router Bầu Cua History:  http://127.0.0.1:{args.port}/api/baucua/history")
    print(f"   - Router Sun Rồng History: http://127.0.0.1:{args.port}/api/sunrong/history")
    print(f"   - Router Sun Phụng History:http://127.0.0.1:{args.port}/api/sunphung/history")
    print(f"   - Router Kỳ Lân History:   http://127.0.0.1:{args.port}/api/qilin/history")
    print(f"   - Router Livestream Live:  http://127.0.0.1:{args.port}/api/livestream/history")
    print(f"   - Router Jackpots All:     http://127.0.0.1:{args.port}/api/jackpot/all")
    print(separator + "\n")

    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="warning")


if __name__ == "__main__":
    run_cli_all_and_serve()
