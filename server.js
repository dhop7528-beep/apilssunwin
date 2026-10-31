import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_FILE = path.join(__dirname, "sunwin_session_cache.json");

// ==========================================
// 1. SESSION MANAGER (XỬ LÝ TOKEN OAUTH2)
// ==========================================
const DEFAULT_AUTH_DATA =
  "eyJkYiI6InVGeUh3TFpaUTJEV3RyS3B4cXlsODFxeDkyRTZCWkczU2NyUVIrem5GZ1JnRFBROHJRSnpKYUdUVHVoQlJ1SUgwSE5" +
  "LazFwS29CbEhieC9RZDZkQ0N2SWZSZ2ZQK01mVDBtT2xKL2I2TkhPV1ZCbk9BdXdvNWdDN1NRVGhET0lPSkFBMDIxYXQxY1Ns" +
  "WGlnQXdpYkNTS0I5bi9KaGhsYnVVeVZINDhMaEJHSFh0Mnc2dk0zejRwR3orQVBzRklEQ2MxV1Q4bzlDbThGa2JYWmN0K0JXZ" +
  "1JTUkhmWDdZOThuMjBqQXlFUzR2cXorRUxPeUlneVhZNUk2QXozcmhGOEViM2wzR2tJQjRzUW02N04xSytYWUMvcjUvNFR2c" +
  "1g2K1NUUzVoVmFSbjc4ZnJySDZCTWdyY2ZRUjhXSnhaamJyVmVxVzQ2YzEzRTdaR2xreXVmQ3Q1eU94eWZUNjF5N2VZczdFV" +
  "kJSREEvM0hnYVhZWE9uaGp2YUZ3VU9TcGl2RlVqdzhCeEVjbHl4blNWaHlQNmFJUzRHUENUM0lST2VjcW4rKzJseThBbnVNN" +
  "jhIdEpIM09rcytwaGRZUU56aHRJQ0diL2lvR0pQNTBMQWdreW1OdlNucHo3cGFRU0Yrb2VxQVdtTlk3OXc5UG1vNW0rTExka" +
  "WVlejlsKzRDVEdDMHdGbWhZK0ttcVh4MDloNzJzaz0iLCJjYyI6IjI1bXNoU3NPQjExTFU5bEUiLCJ2bCI6IkdZNjBpRVZWZ" +
  "C8vL1dieFRYZG1EKzMzYk41WDZyNXdsdkVCckpRaVNFWWIyWEJndXRreWhTWEJuK3YydVJWT2R2Mm1EUFJ5aU1GMEpEMUZNe" +
  "k9BR3U4VjNqM0ppc0dhdGU0VVRqZCtmRW9HRjZtQUV6Q1BZcWhsOThlczBzT2xLZ29adXJPU0FpZW5TYURBN1NJN3RyenMwd" +
  "01pOVFSUTVsTldjMVNEWjRuQnYrRmFSa0xVUmR2Uy9RZFJ1VnJ5bVg5Kzd0azU3V25HVWdZaU9XY3hFSmQrY3VCeS9SWE0vN" +
  "2UvQnk1ZjMrYUZGUlJLVEsvdDlRc0JtVnJEdzRWZHFHZndnNW1kbkZoREZ1bmk2YUpFbi9FUDdCUVBxSkRQa3grbnRGckxkU" +
  "HlCc2RTRDF6LzVJV1VJM3ZyNWdpYm9EbktjL3pFaHl3NlpncnJUaHMwUit5QT09IiwidiI6IjIifQ%3D%3D";

const DEFAULT_CODE_VERIFIER = "prwrruOArDsVNB7bPcpG98QQNSBL4RSibmcOfhLoIlM";

class SunwinSessionManager {
  constructor() {
    this.sessionData = {
      accessToken: "6235ec389a404bf797894ed84a71f5ec",
      refreshToken: "3425a15d79174b3abb1c750690bf3a3a.9d9cd6fadc4c454ea3216b25d1db68f0",
      wsToken: "",
      signature: "",
      deviceId: "Jo0hruhSJj4T9JcssKpr",
      platformId: 4,
      cookie: "_vid_t=Bjrx8Lh3VzJNX2lB7Wq7n/fvNgO1YUxE+EVDXi1g5TW8EwJQHn6+UN+H7rjcvSHmPzTCkZVZXH38sQ==",
      auth_data_param: DEFAULT_AUTH_DATA,
      code_verifier: DEFAULT_CODE_VERIFIER,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
        "Origin": "https://web.sunwin.tickets",
        "Referer": "https://web.sunwin.tickets/",
      },
    };

    // Load cache nếu có
    if (fs.existsSync(CACHE_FILE)) {
      try {
        const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
        this.sessionData = { ...this.sessionData, ...cached };
        console.log("Đã nạp tham số từ cache.");
      } catch (e) {
        console.error("Lỗi đọc cache:", e.message);
      }
    }
  }

  saveCache() {
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this.sessionData, null, 2), "utf-8");
    } catch (e) {
      console.warn("Không thể ghi file cache:", e.message);
    }
  }

  async autoRefreshTokens() {
    console.log("🔄 Đang tự động làm mới Token...");
    let vid_t = null;
    const cookieStr = this.sessionData.cookie || "";
    for (const part of cookieStr.split(";")) {
      if (part.includes("_vid_t=")) {
        vid_t = part.split("_vid_t=")[1].trim();
      }
    }

    const dataParam = this.sessionData.auth_data_param || DEFAULT_AUTH_DATA;
    const codeVerifier = this.sessionData.code_verifier || DEFAULT_CODE_VERIFIER;

    const axiosInstance = axios.create({
      headers: {
        "User-Agent": this.sessionData.headers["User-Agent"],
        Origin: this.sessionData.headers["Origin"],
        Referer: this.sessionData.headers["Referer"],
      },
      validateStatus: () => true, // Cho phép nhận mọi status code
    });

    if (vid_t) {
      axiosInstance.defaults.headers.common["Cookie"] = `_vid_t=${vid_t}`;
    }

    const authUrl = `https://login.sunwin.tickets/auth/authorize?data=${dataParam}`;

    try {
      const r1 = await axiosInstance.get(authUrl, { maxRedirects: 0 });
      const loc = r1.headers.location || "";
      const codeMatch = loc.match(/code=([a-zA-Z0-9-]+)/);

      if (!codeMatch) {
        console.warn("Không lấy được code từ Location.");
        return false;
      }

      const code = codeMatch[1];
      const tokenUrl = "https://login.sunwin.tickets/auth/token";

      let r2 = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        r2 = await axiosInstance.post(tokenUrl, {
          code: code,
          code_verifier: codeVerifier,
        });
        if (r2.status === 200) break;
        console.warn(`Đổi token lần ${attempt + 1} thất bại (HTTP ${r2.status}), thử lại...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (!r2 || r2.status !== 200) return false;

      const tinfo = r2.data?.data?.data || {};
      const newAccessToken = tinfo.accessToken;

      if (newAccessToken) {
        this.sessionData.accessToken = newAccessToken;
        this.sessionData.refreshToken = tinfo.refreshToken || this.sessionData.refreshToken;
        this.sessionData.wsToken = tinfo.wsToken || this.sessionData.wsToken;
        this.sessionData.signature = tinfo.signature || this.sessionData.signature;
        this.saveCache();
        console.log(`✅ LÀM MỚI TOKEN THÀNH CÔNG: ${newAccessToken}`);
        return true;
      }
      return false;
    } catch (e) {
      console.error("Lỗi Auto-Refresh:", e.message);
      return false;
    }
  }
}

// ==========================================
// 2. API CLIENT (CHỈ TÀI XỈU)
// ==========================================
class SunwinApiClient {
  constructor(sessionMgr) {
    this.mgr = sessionMgr;
    this.session = sessionMgr.sessionData;
  }

  getTaiXiuMatchHistory() {
    // Tạo data mẫu (Mày có thể kết nối WebSocket để lấy data thật thay thế)
    const sampleResults = [
      [728190, 5, 4, 3, "TÀI"],
      [728191, 2, 2, 4, "XỈU"],
      [728192, 6, 5, 2, "TÀI"],
      [728193, 1, 3, 5, "XỈU"],
      [728194, 6, 6, 1, "TÀI"],
      [728195, 3, 4, 4, "TÀI"],
      [728196, 1, 2, 3, "XỈU"],
      [728197, 5, 5, 5, "BÃO TÀI"],
      [728198, 2, 4, 3, "XỈU"],
      [728199, 6, 4, 5, "TÀI"],
    ];

    const recentSessions = sampleResults.map((row, i) => {
      const [sid, d1, d2, d3, res] = row;
      return {
        sessionId: sid,
        gameId: 100,
        gameName: "Tài Xỉu Cân Cửa",
        dices: [d1, d2, d3],
        total_score: d1 + d2 + d3,
        result: res,
        totalTaiBetting: 1854200000 + i * 50000000,
        totalXiuBetting: 1821000000 + i * 48000000,
        totalTaiUser: 1420 + i * 15,
        totalXiuUser: 1390 + i * 12,
        timestamp: Date.now() - (10 - i) * 50000,
      };
    });

    return {
      game_category: "LỊCH SỬ VÁN CHƠI TÀI XỈU CÂN CỬA",
      wss_gateway: "wss://websocket.azhkthg1.net/wsbinary",
      plugin: "taixiuPlugin",
      recent_sessions: recentSessions,
    };
  }
}

// ==========================================
// 3. KHỞI TẠO EXPRESS SERVER
// ==========================================
const app = express();
const PORT = process.env.PORT || 8000;

const sessionManager = new SunwinSessionManager();
const client = new SunwinApiClient(sessionManager);

// Route API: Tài Xỉu
app.get("/api/taixiu/history", (req, res) => {
  try {
    const data = client.getTaiXiuMatchHistory();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route API: Refresh Token
app.post("/api/auth/refresh", async (req, res) => {
  const ok = await sessionManager.autoRefreshTokens();
  if (ok) {
    res.json({ status: "success", accessToken: sessionManager.sessionData.accessToken });
  } else {
    res.status(500).json({ detail: "Refresh token thất bại" });
  }
});

// Route Giao diện (Dashboard)
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <title>Sunwin Tài Xỉu Cân Cửa API</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b1120; color: #f8fafc; margin: 0; padding: 25px; }
            h1 { color: #f59e0b; margin-bottom: 5px; }
            p { color: #94a3b8; margin-top: 0; }
            .card { background: #1e293b; border-radius: 8px; padding: 18px; border: 1px solid #334155; max-width: 600px; margin-top: 20px; }
            .card h3 { margin-top: 0; color: #38bdf8; }
            .btn { display: inline-block; padding: 7px 14px; background: #d97706; color: white; text-decoration: none; border-radius: 5px; font-weight: 500; font-size: 13px; margin-top: 8px; margin-right: 5px; }
            .btn:hover { background: #b45309; }
        </style>
    </head>
    <body>
        <h1>🔥 Sunwin Tài Xỉu API (Node.js)</h1>
        <p>Hệ thống tự động trích xuất Lịch Sử Ván Chơi Tài Xỉu Cân Cửa</p>
        
        <div class="card">
            <h3>🎲 Tài Xỉu Cân Cửa</h3>
            <p>Bảng cầu và lịch sử các phiên Tài Xỉu (3 mặt xúc xắc, tổng điểm, Tài hay Xỉu, tổng cược).</p>
            <a class="btn" href="/api/taixiu/history" target="_blank">Xem API Tài Xỉu</a>
        </div>
    </body>
    </html>
  `);
});

// Khởi động server
app.listen(PORT, async () => {
  console.log(`\n==================================================`);
  console.log(`🔥 KHỞI ĐỘNG HỆ THỐNG SUNWIN TÀI XỈU (NODE.JS) 🔥`);
  console.log(`🌐 Server đang chạy tại cổng: ${PORT}`);
  console.log(`- API Tài Xỉu:  http://localhost:${PORT}/api/taixiu/history`);
  console.log(`==================================================\n`);

  // Chạy auto refresh token khi khởi động
  await sessionManager.autoRefreshTokens();
});
