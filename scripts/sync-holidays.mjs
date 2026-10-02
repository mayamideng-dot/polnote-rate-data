import fs from "node:fs";

const apiKey = process.env.KASI_SERVICE_KEY?.trim();
if (!apiKey) {
  throw new Error("KASI_SERVICE_KEY가 등록되지 않았습니다.");
}

const fileName = "holidays.json";
const existing = JSON.parse(fs.readFileSync(fileName, "utf8"));
const currentYear = Number(
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric"
  }).format(new Date())
);

async function fetchYear(year) {
  const holidays = {};

  for (let month = 1; month <= 12; month += 1) {
    const url = new URL(
      "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo"
    );

    url.searchParams.set("ServiceKey", decodeURIComponent(apiKey));
    url.searchParams.set("solYear", String(year));
    url.searchParams.set("solMonth", String(month).padStart(2, "0"));
    url.searchParams.set("numOfRows", "100");
    url.searchParams.set("_type", "json");

    const response = await fetch(url);
    const payload = await response.json();
    const header = payload?.response?.header;

    if (!response.ok || header?.resultCode !== "00") {
      throw new Error(
        `${year}년 ${month}월 조회 실패: HTTP ${response.status}, ` +
        `API ${header?.resultCode || "없음"} - ${header?.resultMsg || "응답 확인 필요"}`
      );
    }

    const sourceItems = payload?.response?.body?.items?.item || [];
    const items = Array.isArray(sourceItems) ? sourceItems : [sourceItems];

    for (const item of items) {
      if (item.isHoliday !== "Y" || !item.locdate) {
        continue;
      }

      const date = String(item.locdate);
      const key = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
      holidays[key] = item.dateName;
    }
  }

  return holidays;
}

const next = structuredClone(existing);
let changed = false;

for (const year of [currentYear, currentYear + 1]) {
  const holidays = await fetchYear(year);
  const previous = existing.years?.[String(year)]?.holidays || {};

  if (JSON.stringify(previous) !== JSON.stringify(holidays)) {
    changed = true;
  }

  next.years[String(year)] = {
    status: "synced",
    syncedAt: new Date().toISOString(),
    source: "한국천문연구원_특일 정보",
    holidays
  };
}

if (changed) {
  next.updatedAt = new Date().toISOString();
  fs.writeFileSync(fileName, `${JSON.stringify(next, null, 2)}\n`);
  console.log("HOLIDAYS_CHANGED=true");
} else {
  console.log("HOLIDAYS_CHANGED=false");
}
