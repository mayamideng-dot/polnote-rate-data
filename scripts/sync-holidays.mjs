import fs from "node:fs";

const apiKey = process.env.KASI_SERVICE_KEY;
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

function tagValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1].trim() : "";
}

function parseItems(xml) {
  const matches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  return matches
    .map((item) => ({
      date: tagValue(item, "locdate"),
      name: tagValue(item, "dateName"),
      isHoliday: tagValue(item, "isHoliday")
    }))
    .filter((item) => item.date && item.isHoliday === "Y");
}

async function fetchYear(year) {
  const holidays = {};

  for (let month = 1; month <= 12; month += 1) {
    const url = new URL(
      "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo"
    );

    url.searchParams.set("serviceKey", apiKey);
    url.searchParams.set("solYear", String(year));
    url.searchParams.set("solMonth", String(month).padStart(2, "0"));
    url.searchParams.set("numOfRows", "100");

    const response = await fetch(url);
    const xml = await response.text();

    if (!response.ok || tagValue(xml, "resultCode") !== "00") {
      throw new Error(`${year}년 ${month}월 공휴일 조회 실패`);
    }

    for (const item of parseItems(xml)) {
      const key = `${item.date.slice(0, 4)}-${item.date.slice(4, 6)}-${item.date.slice(6, 8)}`;
      holidays[key] = item.name;
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
