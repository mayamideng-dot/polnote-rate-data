import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const OC = process.env.LAW_API_OC;

if (!OC) {
  throw new Error("LAW_API_OC Secret이 없습니다.");
}

const KST_OFFSET = 9 * 60 * 60 * 1000;
const now = new Date();
const kst = new Date(now.getTime() + KST_OFFSET);
const isFirstDayInKorea = kst.getUTCDate() === 1;

if (process.env.GITHUB_EVENT_NAME === "schedule" && !isFirstDayInKorea) {
  console.log("한국 시간 기준 매월 1일이 아니므로 점검을 건너뜁니다.");
  process.exit(0);
}

const targets = [
  { group: "법령검색", name: "형법" },
  { group: "법령검색", name: "민법" },
  { group: "연령계산", name: "소년법" },
  { group: "연령계산", name: "아동복지법" },
  { group: "연령계산", name: "청소년보호법" },
  { group: "성범죄", name: "성폭력범죄의 처벌 등에 관한 특례법" },
  { group: "성범죄", name: "아동·청소년의 성보호에 관한 법률" },
  { group: "경범죄", name: "경범죄 처벌법" }
];

const hash = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex");

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function fetchLaw(name) {
  const url = new URL("https://www.law.go.kr/DRF/lawSearch.do");
  url.searchParams.set("OC", OC);
  url.searchParams.set("target", "law");
  url.searchParams.set("type", "JSON");
  url.searchParams.set("display", "5");
  url.searchParams.set("query", name);

  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`${name} 조회 실패: HTTP ${response.status}`);
  }

  const text = await response.text();

  if (!text.trim()) {
    throw new Error(`${name} 조회 결과가 비어 있습니다.`);
  }

  return {
    url: url.toString().replace(OC, "***"),
    responseHash: hash(text)
  };
}

const previousData = await loadJson("law-data.json", {
  schemaVersion: 1,
  updatedAt: null,
  laws: {}
});

const checkedAt = new Date().toISOString();
const laws = {};
const changedItems = [];

for (const target of targets) {
  const result = await fetchLaw(target.name);
  const before = previousData.laws?.[target.name];

  if (before?.responseHash && before.responseHash !== result.responseHash) {
    changedItems.push({
      group: target.group,
      name: target.name
    });
  }

  laws[target.name] = {
    group: target.group,
    checkedAt,
    ...result
  };
}

const isInitialCheck = !previousData.updatedAt;

const lawData = {
  schemaVersion: 1,
  updatedAt: checkedAt,
  laws
};

const status = {
  schemaVersion: 1,
  checkedAt,
  changed: !isInitialCheck && changedItems.length > 0,
  reviewRequired: !isInitialCheck && changedItems.length > 0,
  changedItems,
  sources: {
    provider: "국가법령정보센터 Open API",
    targetCount: targets.length
  }
};

await writeFile(
  "law-data.json",
  `${JSON.stringify(lawData, null, 2)}\n`,
  "utf8"
);

await writeFile(
  "law-check-status.json",
  `${JSON.stringify(status, null, 2)}\n`,
  "utf8"
);

console.log(
  `법령 점검 완료: ${targets.length}건, 변경 ${changedItems.length}건`
);
