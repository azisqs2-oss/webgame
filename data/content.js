// ============================================================
//  기본 설정 파일
//  - 이벤트·선택지·보상 → data/choices.csv (엑셀로 열어서 수정)
//  - 메인 스토리       → data/story.csv   (엑셀로 열어서 수정)
//  - 핵심 NPC          → data/npcs.csv    (엑셀로 열어서 수정)
//  - 상점 아이템       → data/items.csv   (엑셀로 열어서 수정)
//  - 그 밖의 설정(종족, 마을, 직업, 계정 보너스, 숫자 규칙)은 이 파일에서 수정
//  마을 직업 연결과 직업·등급 이름은 아직 임시입니다.
//  ※ 이 파일을 고치면 서버가 다시 켜져야 반영됩니다 (npm run dev 면 자동).
// ============================================================

// 능력치. key 는 DB 컬럼 이름이라 바꾸지 마세요.
// name 을 바꾸면 CSV 파일의 열 이름(힘, 지능 ...)도 똑같이 바꿔야 합니다.
// ※ 사교성은 '있으면 좋고 없으면 아쉬운' 능력치: 사교성 판정은 성공해도 사교성을 주지 않고 다른 능력치를 줌
//   (CSV 에 사교성 판정 + 사교성 보상을 같이 적으면 /data 페이지에 경고가 뜸)
const STATS = [
  { key: 'str',   name: '힘' },
  { key: 'intel', name: '지능' },
  { key: 'agi',   name: '민첩성' },
  { key: 'cha',   name: '사교성' },
];

// 칭호 전용 특별 능력치. 일반 능력치와 달리 캐릭터 생성·성장·상점·보너스 분배로는 오르지 않고,
// 나중에 칭호를 통해서만 얻게 할 예정. 지금은 모두 0으로 시작하고 아무 효과도 없습니다.
const SPECIAL_STATS = [
  { key: 'luck', name: '행운' },
];

// 마법 능력치. 마법사 이야기에서만 얻음 (0이면 화면에 안 보임). 지금은 효과 없음.
// CSV 의 '마나' 칸으로 올릴 수 있음. key 는 DB 컬럼 이름이라 바꾸지 마세요.
const MAGIC_STATS = [
  { key: 'mana', name: '마나' },
];

// 칭호 효과: 칭호를 얻는 순간 한 번 적용 (계정 보너스로 받은 칭호도 같음). 여기 없는 칭호는 효과 없음
const TITLES = {
  // 세실에게 준 답례품 표시용 (능력치 없음) — 뒷이야기에서 '분기 조건/선택 조건: 칭호 선물은 쿠키' 처럼 씀 (사용자 제안 2026-11-23)
  '선물은 쿠키': { effects: {}, desc: '세실에게 답례로 쿠키를 건넸다' },
  '선물은 목검': { effects: {}, desc: '세실에게 답례로 목검을 건넸다' },
  '안아프게 맞기': { effects: { agi: 1 }, desc: '타락한 산의 주인의 공격 24번을 끝까지 막아 내고 버텼다' },
  '막대기로 이게 된다고?': { effects: { str: 2 }, desc: '막대기 하나로 늑대의 공격을 Just Guard 로 15번 넘게 막아 냈다' },
  // 바르크 숲 늑대 노히트(전부 Just Guard) 클리어 마릿수 칭호 (사용자 지정 · NOHIT_CHAINS 참고)
  '전투의 재능': { effects: { agi: 1 }, desc: '숲의 늑대 한 마리를 Just Guard 만으로 쓰러뜨렸다' },
  '늑대 사냥꾼': { effects: { str: 1 }, desc: '숲의 늑대 두 마리를 Just Guard 만으로 쓰러뜨렸다' },
  '늑대 상대가 제일 쉬웠어요': { effects: { intel: 1, cha: 1 }, desc: '숲의 늑대 세 마리를 Just Guard 만으로 쓰러뜨렸다' },
  '완벽한 가드!': { effects: { str: 1, agi: 1 }, desc: '숲의 늑대 네 마리를 모두 Just Guard 만으로 쓰러뜨렸다 (계정 칭호)' },
  '그랜드 슬램': { effects: { cha: 3 }, desc: '「완벽한 가드!」를 지닌 채 그리즐리 베어를 쓰러뜨렸다 (계정 칭호)' },
  '그왈흐메이의 동전': { effects: { luck: 1 }, desc: '용사 그왈흐메이가 행운을 빈다며 건넨 동전' },
  '희석된 성수': { desc: '사령 동굴에서 그왈흐메이가 건넨 성수 한 병 (이후 이야기에서 쓰일 예정)' },
  '레인저': { effects: { agi: 2 }, desc: '다섯 개의 무덤 앞에서, 알파에게 리안의 레인저로 인정받았다' },
  '하루 종일도 할 수 있어': { effects: { luck: 1 }, desc: '산의 주인의 공격을 전부 Just Guard 로 받아 냈다 (계정 칭호)' },
  '전사에 재능이 있었을지도···': { effects: { str: 2 }, desc: '마나를 각성하기 전, 막대기 하나로 늑대의 공격을 Just Guard 로 10번 넘게 막아 냈다' },
};

// 성별에 따라 바뀌는 호칭. CSV 문장에 {형} 처럼 쓰면 캐릭터 성별에 맞게 바뀜
//   (남성·여성 외에는 '기본')
const GENDER_WORDS = {
  '형':   { 남성: '형',   여성: '누나', 기본: '형' },   // 남자아이가 부를 때
  '오빠': { 남성: '오빠', 여성: '언니', 기본: '오빠' }, // 여자아이가 부를 때
};

// 성장기 시작 나이와 성인 나이 (차이가 작을수록 성장기가 짧아짐)
const START_AGE = 8;
const ADULT_AGE = 16;
// 세실(예전 이름 앨리스 · 사용자 지정 2026-11-22 개명)의 나이 = 주인공 나이 − 4 (사용자 지정 · 이야기 속 {세실나이})
const ALICE_AGE_GAP = 4;

// 성장기에 큰 사건이 일어날 확률 (0~1). 마을 메인 스토리는 이와 상관없이 반드시 일어남.
const GROWTH_EVENT_CHANCE = 0.7;

// 성장기 1년에 일어나는 이벤트 수 (큰 사건 포함). 나머지는 choices.csv 의 '소소' 이벤트로 채움.
//   normal   : 마을 메인 스토리가 없는 해
//   storyYear: 마을 메인 스토리가 있는 해 (소소 이벤트 + 스토리)
// 같은 해에는 같은 소소한 이벤트가 두 번 나오지 않고, 안 본 것부터 우선 나옴.
const EVENTS_PER_YEAR = { normal: { min: 5, max: 6 }, storyYear: { min: 6, max: 7 } };

// 성장기가 끝나면 직접 분배하는 보너스 포인트
const BONUS_POINTS = 5;

// 태어날 때 가진 골드 (용돈). 성장기 이벤트에서 쓸 수 있고, 남은 돈은 성인이 될 때 그대로 이어짐
const CHILD_GOLD = 40;

// 성인이 될 때 추가로 받는 골드
const START_GOLD = 30;

// 성인이 되면(마을 스토리가 끝나면) 모든 캐릭터는 왕도로 모입니다. 협동 의뢰·게시판의 무대.
const CAPITAL = { name: '왕도', arriveText: '{마을}을 떠나 왕도에 도착했다. 각지에서 모여든 사람들로 거리가 북적인다.' };

// 성장기 일상: CSV의 '일상' 칸으로 켜면, 그 뒤로 매년 '다음 해'를 누를 때마다 이 일과가 먼저 흘러갑니다.
//   ('없음'을 적으면 꺼짐. 성인이 되면 자동으로 꺼짐)
const ROUTINES = {
  '장작 패기': { text: '마을 곳곳을 돌며 장작을 팼다. 손바닥에 굳은살이 박이기 시작했다.', effects: { str: 1 } },
  '검술 수련': { text: '해가 질 때까지 일리치에게 검을 배웠다.', effects: { str: 1, agi: 1 } },
  '한스의 잡일': { text: '한스의 오두막에 장작과 물을 채우고, 해가 지면 체스판 앞에 앉았다. 물론 한 판도 이기지 못했다.', effects: { str: 1, intel: 1 } },
  '마법 이론': { text: '한스에게 마법 이론을 배웠다. 알아들을 수 없는 말투성이였지만, 책장은 조금씩 넘어갔다.', effects: { intel: 2 } },
  '흔적 읽기': { text: '알파를 따라 숲 가장자리를 돌며 짐승의 흔적을 읽었다. 진흙 위의 발자국이 조금씩 말을 걸어오기 시작했다.', effects: { agi: 1, intel: 1 } },   // 임시 작성
  '석궁 다루기': { text: '해가 질 때까지 석궁을 쏘았다. 과녁에 꽂히는 화살이 하나둘 늘어 갔다.', effects: { agi: 2 } },   // 임시 작성
};

// 성인 이후 흐름:  협동 의뢰로 능력치를 올림 → 메인 스토리 장마다 '필요 능력치'를 넘겨야 진행
//                  → 그 등급의 장을 전부 끝내면 승급 시험(전투)에 도전
// 메인 스토리 (내용은 data/story.csv)
//   passSeason   : 한 장을 진행하면 한 계절이 지나는지
//   ignoreFatigue: 피로도가 높아도 진행할 수 있는지
//   openIfEmpty  : 그 등급에 아직 작성된 장이 없으면 승급 시험을 바로 열지 (스토리 작성 전 테스트용)
// unlockAfter = 이 장면을 끝까지 보면 협동·1인 격파·단련·상점이 열림 (왕도 첫 이야기 · 사용자 지정)
// rankGates[n] = 등급 n → n+1 승급 시험이 열리는 메인 스토리 마지막 장면 (사용자: 메인 스토리 하나 끝날 때마다 등급 하나씩 해금)
//   목록에 없는 등급은 승급 불가 (다음 메인 스토리가 생기면 여기에 추가). 지금은 1번 승급까지만.
// 승급: rankGates[n] = 등급 n→n+1 승급을 여는 장면 (사용자 지정 2026-11-21: 1·2장 → 승급 1번 → 3장 보호소의 아이들~5장 → 승급 2번)
// storyReq[n] = 등급 n 메인 스토리를 이어가려면 채워야 하는 조건 (사용자 지정 2026-11-22: 은 등급(3~5장) 이야기에 힘/민첩/지능 중 하나 50 이상 · 나이 20세 이하. 승급 시험 자체엔 조건 없음)
// 계절이 바뀔 때 사건: count = 계절 사건 수 (겹치지 않게, 그 계절에 그만큼 없으면 있는 만큼)
//   luckPct = 행운 1당 '행운' 사건(choices.csv 구분 '행운')이 끼어들 확률 % (행운 7 → 7%) · 사용자 지정 2026-11-23
const SEASON_EVENTS = { count: 3, luckPct: 1 };

// 지능 보너스: 지능 per 마다 얻는 골드 +pct (스토리·이벤트·1인 격파·협동 보상 모두 · 사용자 지정 2026-11-23)
const GOLD_BONUS = { stat: 'intel', per: 5, pct: 0.03 };

const STORY = { passSeason: true, ignoreFatigue: false, openIfEmpty: true, unlockAfter: 'st_cap_2_inn', rankGates: ['st_cap_2_inn', 'st_cap_5_gift'],
  storyReq: { 1: { name: '메인 스토리', anyOf: ['str', 'agi', 'intel'], min: 50, maxAge: 20 } } };

// 전직: CSV의 '전직' 칸으로 직업이 바뀔 때 등급을 유지할지 (false 면 새 직업의 첫 등급부터)
const JOB_CHANGE_KEEP_RANK = true;

// 종족: 모두 인간으로 통일 (선택 화면 없음)
const RACES = [
  { name: '인간', bonus: {}, desc: '' },
];

// 마을 (임시). 태어난 마을이 시작 직업을 정합니다. (음유시인·세레나는 사용자 결정으로 삭제) 직업은 아래 JOBS 의 이름과 같아야 해요.
// 이후 직업은 이벤트·등급에 따라 '전직'으로만 바뀝니다 (CSV 의 전직 칸).
const VILLAGES = [
  { name: '바르크',       job: '전사',     bonus: { str: 2 },   desc: '왕국 최외곽에 있는 자그마한 개척촌.' },
  { name: '엘름',         job: '마법사',   bonus: { intel: 2 }, desc: '뛰어난 품질의 포도를 기반으로 경제 활동이 활발하게 이루어지는 도시.' },
  { name: '리안',         job: '사냥꾼',   bonus: { agi: 2 },   desc: '대수림 인근과 맞닿아 있는 마을.' },
];

// 성격 태그. 캐릭터 생성 때 2개 고릅니다.
const TAGS = [
  { name: '대담함', bonus: { str: 1, agi: 1 } },
  { name: '신중함', bonus: { agi: 1, intel: 1 } },
  { name: '재빠름', bonus: { agi: 2 } },
  { name: '다정함', bonus: { cha: 2 } },
  { name: '호기심', bonus: { intel: 2 } },
  { name: '끈기',   bonus: { str: 2 } },
];

// 직업과 등급. 등급은 낮은 것부터 (CSV의 최소등급 0 = 첫 번째 등급).
// 마을에 없는 직업(전직으로만 갈 수 있는 상위 직업)도 여기에 추가하면 됩니다.
// promotions: 승급 시험. 배열 순서대로 [첫 번째 → 두 번째 등급], [두 번째 → 세 번째 등급].
//   그 등급의 메인 스토리를 전부 끝내야 도전할 수 있고, 시험은 전투입니다.
//   enemy : 시험 전투 상대 (아래 COMBAT.enemies 의 ID). 반드시 쓰러뜨려야 합격
//   text  : 시험 장면 문장
//   (칭호는 특정 의뢰에서만 주기로 해서 승급 성공으로는 칭호를 주지 않습니다)
// ---------- 장비 (사용자 지정: 무기 / 보조 무기 / 방어구 / 장신구) ----------
// desc = 장비 칸에 보이는 한 줄 설명 · effects.atk = 공격력 추가 (나중에 강화로 올릴 예정 · 사용자). 비어 있는 칸은 직업의 기본 장비(JOBS[].equipment)로 보임.
// 스토리 CSV `장비` 칸에 ID 를 적으면 그 선택지 성공 시 장착 (칸은 EQUIPMENT 의 slot 으로 정해짐)
const EQUIP_SLOTS = [
  { key: 'weapon', name: '무기' },
  { key: 'sub', name: '보조 무기' },
  { key: 'armor', name: '방어구' },
  { key: 'accessory', name: '장신구' },
];
const EQUIPMENT = {
  iron_sword:   { name: '철검', slot: 'weapon', desc: '전사의 기본적인 무기다.' },                                               // 사용자 예시 문장 형식
  ilyich_sword: { name: '일리치의 검', slot: 'weapon', desc: '왕실 기사단 시절부터 그가 써 온, 손때 묻은 검.', effects: { atk: 3 } },   // 공격력 +3 (사용자 지정)
  saw_blade:    { name: '톱칼', slot: 'weapon', desc: '사냥꾼의 기본적인 무기다.' },                                               // 사용자 예시 문장
  crossbow:     { name: '석궁', slot: 'sub', desc: '사냥꾼의 기본적인 보조 무기다.', effects: { crossbow: 1 } },
  // 세실의 브로치 (사용자 지정): 빗나감(아예 놓친 공격 = 피격) 피해 30% 감소 · 죽으면 체력 1로 귀환 (최대 3회, 남은 횟수는 장비 칸에 표시)
  alice_brooch: { name: '세실의 브로치', slot: 'accessory', desc: '세실이 건네준 작은 은빛 브로치.',
                  effects: { missCut: 0.3, revive: 3 } },
  // ---- 대장간 (사용자 지정 2026-11-21 · 가격 골드 · 설명 문장은 사용자 원문) ----
  // 같은 칸은 마지막으로 산 것만 적용 (갑옷·보조 무기)
  wolf_armor:   { name: '늑대가죽 갑옷', slot: 'armor', price: 100, desc: '없는 것 보단 낫지만, 관리를 대충 하면 끔찍한 냄새가 난다.', effects: { maxHp: 10 } },
  wolf_robe:    { name: '늑대가죽 로브', slot: 'armor', price: 100, desc: '마법사라면 로브를 입어야 한다. 갑옷이 더 마음에 든다고? 너 어디 마탑 출신이냐? -적색 마탑의 마법사', effects: { maxHp: 5, missShield: 1 } },
  round_shield: { name: '라운드 쉴드', slot: 'sub', job: '전사', price: 100, desc: '전사의 영원한 친구', effects: { dmgCut: 0.2, atkFromHp: 0.05 } },
  second_sword: { name: '철검', slot: 'sub', job: '전사', price: 100, desc: '검을 두 자루 쓰면 두 배로 벨 수 있다. 즉, 최강이다. -엘프 출신 검투사', effects: { atkPer10Str: 2 } },
  sharp_crossbow:  { name: '강화된 석궁', slot: 'sub', job: '사냥꾼', price: 100, desc: '낡은 부품을 바꾸고 더욱 날카로운 화살촉을 구했다.', effects: { crossbow: 1, bleedPer: 0.5 } },
  poison_crossbow: { name: '독 석궁', slot: 'sub', job: '사냥꾼', price: 100, desc: '유령어라는 물고기의 허파를 가공하여 독을 채우면, 화살촉에 자동으로 독이 묻게 할 수 있다.', effects: { crossbow: 1, poison: 12 } },
  old_ring:     { name: '어느 노인의 반지', slot: 'sub', job: '마법사', price: 100, desc: '충분한 근육만 있다면 마법과 같은 결과를 낼 수 있다.', effects: { noManaFlat: 1, atkPerStr: 0.5 } },
  mana_shard:   { name: '마석 파편', slot: 'sub', job: '마법사', price: 100, desc: '마석 채취 중 떨어진 부스러기. 온전한 마석은 부르는 게 값이라고들 한다.', effects: { jgBonus: 0.1 } },
  spellbook:    { name: '마법서', slot: 'weapon', desc: '마법사의 기본적인 무기다.' },
};

// 직업명 (사용자 지정 2026-11-21: 모험가 → 전사, 정찰자 → 사냥꾼 — 길드 이야기에 '모험가'를 쓰기 위해). 기존 DB 는 migrate_v13.sql
// 대장간 (사용자 지정): unlockAfter 장면을 끝까지 보면 열림 · 무기 강화 1단계 150골드, 공격력 +3, 최대 3강
const SMITHY = {
  unlockAfter: 'st_cap_4_smith',
  upgrade: { price: 150, atk: 3, max: 3 },
  items: ['wolf_armor', 'wolf_robe', 'round_shield', 'second_sword', 'sharp_crossbow', 'poison_crossbow', 'old_ring', 'mana_shard'],
  // 대장장이 대사 (임시 작성 · 무뚝뚝한 성격 — st_cap_4_smith 의 "…돈은 있고?") · 그림: /img/smithy_bg.jpg (배경) · /img/blacksmith.png (대장장이)
  name: '대장장이',
  lines: {
    greet: ['…돈은 있고?', '구경만 할 거면 화덕 앞은 비켜.', '그 꼬맹이가 데려온 녀석이군. 골라.', '날이 무디면 목숨도 무뎌진다.', '…뭘 봐. 고를 거 골라.'],
    upgrade: ['쇠는 거짓말을 안 하지. 한결 낫군.', '다음에 또 이빨 나가게 쓰면 안 고쳐 준다.', '…괜찮은 칼이 됐어.'],
    maxed: ['이 이상은 내 망치로도 안 된다.'],
    buy: ['잘 골랐어. 함부로 굴리지 마라.', '맞는지 한번 대 봐. …됐군.', '값은 받았다. 가져가.'],
    poor: ['돈 모아서 다시 와.', '외상은 안 받는다.'],
  },
};

const JOBS = [
  {
    name: '전사', mainStat: 'str', ranks: ['동', '은', '금'], desc: '가장 스탠다드한 플레이가 가능한 직업',
    equipment: { weapon: 'iron_sword' },
    promotions: [
      { enemy: 'exam1', text: '길드가 지정한 마물 토벌을 홀로 해내야 한다.' },
      { enemy: 'exam_dark_mage', text: '왕도 지하 수로에 숨어든 흑마법사를 홀로 제압해야 한다.' },   // 사용자 지정: 흑마법사 · 문장은 임시 작성
    ],
  },
  {
    name: '마법사', mainStat: 'intel', ranks: ['1서클', '2서클', '3서클'], desc: '방어 성능이 낮은 대신 뛰어난 화력을 보유',
    equipment: { weapon: 'spellbook' },
    promotions: [
      { enemy: 'exam_mage1', text: '마탑의 시험관 앞에서 두 번째 서클을 완성해 보여야 한다.' },
      { enemy: 'exam_mage2', text: '폭주하는 마력을 다스리며 세 번째 서클을 열어야 한다.' },
    ],
  },
  {
    name: '사냥꾼', mainStat: 'agi', ranks: ['견습', '정식', '숙련'], desc: '높은 방어 성능으로 안정적 운용이 가능',
    equipment: { weapon: 'saw_blade', sub: 'crossbow' },
    promotions: [
      { enemy: 'exam_scout1', text: '숲에 나타난 돌연변이 그리즐리 베어를 사냥해야 한다. 칼날로는 흠집조차 나지 않는다는 괴물이다.' },   // 사용자 지정 (문장은 임시 작성)
      { enemy: 'exam2', text: '누구도 돌아온 적 없는 협곡을 정찰하고 살아 나와야 한다.' },
    ],
  },
];

// 승급 시험 (전투)
//   fatigue : 시험을 보면 쌓이는 피로도 (합격·불합격 모두). 시험이 끝나면 한 계절이 지남
//   피로도가 FATIGUE.questLimit 이상이면 도전 불가. 떨어져도 죽지 않고 다시 도전 가능
const PROMOTION = { fatigue: 30 };

// 1인 격파 (혼자 하는 토벌. 예전 '특별 의뢰'를 대신함 · 협동 의뢰와 별개)
//   반드시 쓰러뜨려야 성공. 져도 죽지 않음. 시간(계절)은 지나지 않고 피로도만 쌓임
//   fatigue : 한 번 도전할 때 쌓이는 피로도 (피로도가 FATIGUE.questLimit 이상이면 도전 불가)
//   attackSlack : 공격 횟수 여유. 공격 횟수 = (적 체력 ÷ 공격력) × 이 값 (작을수록 어려움, 1.0 = 전부 Guard 로 막아야 겨우)
//   reward  : 성공 보상 (협동 의뢰보다 낮게). main = 직업 주 능력치, others = 나머지 능력치 각각
//   hunts   : 목록. enemy 는 COMBAT.enemies 의 ID, minRank 는 도전할 수 있는 최소 등급(0부터)
const SOLO = {
  fatigue: 50,          // 15 → 50 (보상 강화 대신)
  attackSlack: 1.35,
  reward: { main: 2, others: 1, gold: 40 },   // 1·0·10 → 2·1·40
  hunts: [
    // ID 는 예전 그대로 (solo_grizzly) · 몬스터만 오크로 (사용자: 보스 스펙은 같게)
    // minRank 미만이면 목록에 아예 안 보임 · maxRank: 이 등급까지만 보임 (그 위 등급에선 목록에서 빠짐) · goldMult: 골드 보상 배수 (능력치 보상은 그대로)
    { id: 'solo_grizzly', title: '오크 1인 격파', enemy: 'solo_grizzly', minRank: 0, maxRank: 1,
      text: '왕도 근교 숲을 어슬렁거리는 오크 한 마리. 무리에서 떨어져 나온 떠돌이다.' },   // 임시 작성
    // 금 등급(두 번째 승급 뒤)부터 오크 대신 (사용자 지정 2026-11-22: 1인 격파 교체 · 능력치 그대로 · 골드 2배) · 체력 900(협동 1800 의 절반)은 내가 정함 · 피해 26 (사용자: 13이면 사냥꾼이 가드만 쳐도 무적 → 올려라)
    { id: 'solo_dark_mage', title: '흑마법사 1인 격파', enemy: 'solo_dark_mage', minRank: 2, goldMult: 2,
      text: '왕도 외곽의 폐가에 흑마법사 하나가 숨어들었다는 제보. 길드는 은밀히 처리해 주길 바란다.' },   // 임시 작성
    { id: 'test_boss', title: '[테스트]', enemy: 'test_boss', minRank: 0,
      text: '보스 패턴 시험용. 평범한 공격 5번 뒤에 20연타가 몰아친다.' },
  ],
};

// 단련 (특별 의뢰 · 직업 전용). 몬스터 없이 전투 화면에서 중앙을 꾹 누르고 있으면 구체가 자라서 완료.
//   마법사 컨셉: 공격력은 높지만 힘이 낮아 몸이 약하고, 마나는 이런 추가 단련으로만 천천히 오름
//   job: 이 직업만 · needMana: 마나를 각성해야 보임 · holdMs: 눌러야 하는 시간 · fatigue: 피로도 · effects: 보상 (시간은 안 지남)
const TRAINING = [
  { id: 'mana_training', title: '마나 단련', job: '마법사', needMana: true, holdMs: 5000, fatigue: 25, effects: { mana: 1 },
    text: '조용한 곳에 앉아 몸속의 마나를 한곳에 모은다. 흩어지지 않게, 끝까지.' },
];

// 협동 의뢰 (여러 캐릭터가 한 방에 모여 같은 적을 잡음)
//   적 체력(totalHp)을 인원수로 나눠, 각자 자기 몫만큼 깎으면 됨 (예: 1200 ÷ 3명 = 각자 400).
//   한 명이라도 실패하면 그 사람은 구경꾼이 되고, 남은 사람끼리 다시 나눠 재도전 (1200 ÷ 2명 = 각자 600).
//   모두 실패하면 의뢰 실패.
//   minMembers / maxMembers : 시작할 수 있는 최소 인원 / 방 정원
//   방은 공개(목록에 보임) / 비공개(방 코드를 아는 사람만 입장) 중에 고름. codeLength = 방 코드 글자 수
//   allowSameUser : 한 계정의 여러 캐릭터가 같은 방에 들어갈 수 있는지 (혼자 테스트할 때 true)
//   fatigue       : 자기 몫 전투를 하면 쌓이는 피로도. 피로도가 questLimit 이상이면 방을 만들거나 들어갈 수 없음
//   attackSlack   : 공격 횟수 여유. 공격 횟수 = (자기 몫 ÷ 공격력) × 이 값 (모두 Guard 로 막아야 겨우 잡는 게 1.0)
//   reward        : 성공 보상. main = 직업 주 능력치, others = 나머지 능력치 각각
//   spectatorReward: 중간에 실패해 구경한 사람의 보상
//   quests        : 의뢰 목록. enemy 는 COMBAT.enemies 의 ID, minRank 는 받을 수 있는 최소 등급(0부터)
const COOP = {
  minMembers: 1,
  maxMembers: 3,
  allowSameUser: true,
  codeLength: 6,
  fatigue: 50,          // 15 → 50
  attackSlack: 1.35,
  reward: { main: 4, others: 2, gold: 40 },   // 2·1·20 → 4·2·40
  spectatorReward: { main: 1, others: 0, gold: 10 },
  quests: [
    { id: 'coop_grizzly', title: '오크 우두머리 토벌', enemy: 'coop_grizzly', totalHp: 1200, minRank: 0,
      text: '왕도 근교의 숲에 덩치가 산만 한 오크 우두머리가 나타났다. 혼자서는 감당할 수 없다.' },   // 임시 작성
    // 금 등급(두 번째 승급 뒤) 협동 보스 (사용자 지정 2026-11-22: 체력 1800 · 능력치 그대로 · 골드 2배) · 피해 26
    { id: 'coop_dark_mage', title: '흑마법사 소탕', enemy: 'coop_dark_mage', totalHp: 1800, minRank: 2, goldMult: 2,
      text: '왕도 지하 묘지에 흑마법사들이 모여 무언가를 꾸미고 있다. 길드가 여럿을 한꺼번에 보낸다.' },   // 임시 작성
  ],
};

// 계정 영구 보너스: 한 번 조건을 달성하면 그 계정에서 새로 만드는 모든 캐릭터가 혜택을 받습니다.
//   id        : 바꾸지 마세요 (DB에 저장되는 이름)
//   hint      : 칭호 도감(/codex)에 보이는 획득 힌트 (해금 전). 해금하면 desc(정확한 조건)가 보임
//   codex     : false 면 도감에 안 보임 (테스트용)
//   condition : reachAge = 이 나이에 도달하면 해금 / reachStat = 능력치가 이 값에 도달하면 해금 (예: { intel: 50 })
//               seeEvent = 이 장면(들)을 끝까지 보면 해금
//               combatPerfect = { enemy: 적 ID, count: N } → 그 적과의 전투에서 Just Guard N번 이상이면 해금
//               noHitChain = { chain: NOHIT_CHAINS 의 ID, count: N } → 그 묶음의 적을 노히트로 N마리 쓰러뜨리면 해금
//               combatWin = 적 ID → 그 적을 쓰러뜨리면 해금. hasTitle = 그때 이 칭호를 갖고 있어야 함
//               combatNoHit = 적 ID → 그 적과의 전투를 전부 Just Guard 로 끝내면 해금 (버텨내기 전투는 끝까지 버텨야 함)
//   grant     : title = 새 캐릭터가 갖고 시작하는 칭호, luck 등 = 시작 능력치 보너스
// 노히트 마릿수 칭호 (사용자 지정): 적 옵션 noHitChain 이 같은 적들을 노히트(전부 Just Guard 로 승리)로 쓰러뜨린 마릿수에 따라 칭호
//   titles[0] = 1마리, titles[1] = 2마리 ... / account: true 인 칸은 캐릭터 칭호 대신 계정 보너스(ACCOUNT_BONUSES 의 noHitChain 조건)로만
const NOHIT_CHAINS = {
  barck_wolves: [
    { title: '전투의 재능' },
    { title: '늑대 사냥꾼' },
    { title: '늑대 상대가 제일 쉬웠어요' },
    { title: '완벽한 가드!', account: true },
  ],
};

const ACCOUNT_BONUSES = [
  {
    id: 'test_age16', name: '테스트 칭호', desc: '아무 캐릭터로 16세까지 살아남기 (테스트용)', codex: false,
    condition: { reachAge: 16 },
    grant: { title: '테스트 칭호', luck: 1 },
  },
  {
    // 아무 캐릭터로 지능 50 달성 → 다음 캐릭터부터 칭호 「체스 마스터」 → 엘름에서 한스와의 체스를 이길 수 있는 분기가 열림
    id: 'chess_master', name: '체스 마스터', desc: '아무 캐릭터로 지능 50 달성하기',
    hint: '체스판 앞의 노인을 꺾으려면, 무엇보다 머리가 좋아야 한다.',   // 임시 작성
    condition: { reachStat: { intel: 50 } },
    grant: { title: '체스 마스터' },
  },
  {
    id: 'stick_warrior', name: '전사에 재능이 있었을지도···', desc: '엘름 막대기 늑대 전투에서 Just Guard 10번 이상',
    hint: '막대기 한 자루로도 늑대를 몇 번이고 받아 낼 수 있다면, 어쩌면….',   // 임시 작성
    condition: { combatPerfect: { enemy: 'elm_wolf', count: 10 } }, grant: { title: '전사에 재능이 있었을지도···' },
  },
  {
    id: 'perfect_guard', name: '완벽한 가드!', desc: '바르크 숲의 늑대 네 마리를 모두 Just Guard 만으로 쓰러뜨리기',
    hint: '숲의 늑대들에게 단 한 번도 틈을 내주지 않는다면.',   // 임시 작성
    condition: { noHitChain: { chain: 'barck_wolves', count: 4 } }, grant: { title: '완벽한 가드!' },
  },
  {
    id: 'all_day', name: '하루 종일도 할 수 있어', desc: '리안 15세 산의 주인과의 버텨내기를 전부 Just Guard 로 끝내기',
    hint: '재생하는 괴물 앞에서, 단 한 번도 물러서지 않는다면.',   // 임시 작성
    condition: { combatNoHit: 'rian_lord' }, grant: { title: '하루 종일도 할 수 있어' },
  },
  {
    id: 'grand_slam', name: '그랜드 슬램', desc: '「완벽한 가드!」를 지닌 캐릭터로 바르크 숲의 그리즐리 베어 쓰러뜨리기',
    hint: '완벽한 방패를 지닌 자라면, 누구도 넘지 못한 숲의 주인마저.',   // 임시 작성
    condition: { combatWin: 'grizzly', hasTitle: '완벽한 가드!' }, grant: { title: '그랜드 슬램' },
  },
];

// 성장기의 평범한 해 (큰 사건이 없는 해에 무작위로 한 줄)
const DAILY_LINES = [
  '큰일 없이 한 해가 지나갔다.',
  '계절이 조용히 바뀌었다.',
  '마을 어른들의 심부름을 하며 한 해를 보냈다.',
  '키가 한 뼘쯤 자랐다.',
  '비 오는 날이 유난히 많은 해였다.',
  '장터에서 처음 보는 물건을 구경했다.',
];

// 성인 이후 계절
const SEASONS = ['봄', '여름', '가을', '겨울'];

// 피로도 규칙
const FATIGUE = {
  max: 100,
  questLimit: 70,      // 이 값 이상이면 1인 격파·협동 의뢰·승급 시험 불가
  dangerLine: 80,      // 이 값 이상이면 실패 시 사망률 추가
  dangerExtraDeath: 5, // 위험선 이상일 때 추가 사망률(%)
};

// 휴식: 피로도를 크게 낮추고 계절이 지나감
const REST = { fatigue: -40 };

// 전투 (가드 방식)
//   화면 아무 곳에나 붉은 고리(공격 전조)가 생겨 안쪽 원으로 줄어듭니다. 맞닿는 순간 그 원을 클릭·터치하면 가드.
//   판정: perfect = Just Guard, great = Guard, good = Miss(겨우 막음). 그보다 어긋나면 못 막고 damage 만큼 피해.
//   가드하면 바로 반격 → 데미지 = 공격력 × 배율.
//   windows: 판정 범위(밀리초, 맞닿는 순간과의 차이). 작을수록 어려움
//   enemies: 적 목록. CSV의 '전투' 칸에 이 ID를 적으면 그 장면에서 전투가 시작됨
//     hp 적 체력 · damage 못 막았을 때 피해 (v11에서 전부 2배로 올림 · 스토리 베어·엘름 늑대는 그대로) · attacks 공격 횟수(다 버티면 적이 물러남)
//     approach 전조가 보이는 시간(ms, 길수록 쉬움) · gapMin/gapMax 공격 사이 간격(ms)
//     lethal: false 면 져도 죽지 않음 → loseHp 로 버팀 (스토리 전투용)
//     guardDamage: 막아도 받는 피해 { perfect, great, good } (기본 0)
//     rescue: true 면 HP가 0이 되는 순간 쓰러지는 대신 누군가 난입해 막아 줌 (rescueName = 난입하는 사람)
//       → 난입하면 선택지 2번 줄, 끝내 쓰러뜨리면 선택지 1번 줄 결과로 진행
//       rescueAt: 이 HP 아래로 떨어지려는 순간 발동 (없으면 0이 되는 순간) · rescueTitle: 화면 가득 뜨는 큰 글자 (기본 Just Guard)
//       rescueStyle: 'flame' 이면 노란 Just Guard 대신 붉은 불꽃 · rescueLog: 기록에 남을 문장 (있으면 [성공] 처리)
//     immune: true 면 반격해도 적에게 피해가 들어가지 않음
//     art: 'none' 이면 적 없이 패턴만 (남은 공격 수 표시) · bg: 'arcane' = 마탑 배경 · winText/clearLog/failLog = 합격 문구
//     manaShield: N → 민첩 대신 마나로 받는 피해 감소. 피격·Miss·Guard 모두 (마나 × N) 만큼 줄어듦 (마탑의 시험 · 마나 단련 하고 오라는 뜻)
//     titleOn: { perfect: N, title: '칭호' } → 그 전투에서 Just Guard 를 N번 이상 하면 칭호 획득
//     hideHp: true 면 적 체력을 ??? 로 표시 (실제 체력은 그대로)
// NPC 호감도는 0~100 사이로 유지됨
//     pattern: 공격 패턴 (있으면 gapMin/gapMax 대신 사용). 단계를 순서대로 돌고, 끝나면 처음부터 반복
//       [{ count: 공격 수, gapMin, gapMax, pause: 이 단계 시작 전 쉬는 시간(ms), sameSpot: 같은 자리 연타 수 }, ...]
//     mustKill: true 면 공격을 다 버텨도 소용없고, 적 체력을 0으로 만들어야 승리 (승급 시험·협동 의뢰)
//     art: 그림 종류(wolf / bear) · image: 그림 파일 (public 폴더 기준). 파일이 없으면 도형으로 그림
// HP: 최대 HP = hpBase + 힘 × hpPerStr. 성장기엔 해가 바뀔 때 가득 회복, 성인은 계절이 지날 때 최대 HP의 seasonHeal 만큼 회복.
//   전투 밖(이벤트의 체력 칸)에서는 HP가 1 아래로 내려가지 않음.
const COMBAT = {
  hpBase: 30, hpPerStr: 2,
  seasonHeal: 0.6,                  // 성인: 계절이 지날 때 최대 HP의 60% 회복 (예전엔 가득)          // 최대 HP = 30 + 힘 × 2
  atkBase: 4, atkPerStr: 0.5,       // 공격력 = 4 + 힘 × 0.5
  // 마법사(마나를 각성한 뒤)의 전투: 공격 전조가 마법진으로 나오고, 반격 = (4 + 지능 × 0.5) × 판정 배율 + 마나 × manaFlat (고정 추가)
  magic: { atkBase: 4, atkPerInt: 0.5, manaFlat: 1 },
  // 사냥꾼 전투 (사용자 지정 · 2026-11-21 직업명 정찰자 → 사냥꾼): 무기가 톱칼이면 반격은 약한 대신 막을 때마다 출혈을 쌓음
  //   반격 = atkBase + 민첩 × atkPerAgi · Guard 이상으로 막으면 출혈 +1, Just Guard + 석궁(보조 무기)이면 +1 더
  //   출혈: 적이 공격할 때마다 (중첩 × perStack) 피해 · 최대 maxStacks 중첩
  //   출혈이 최대 중첩일 때 Just Guard 를 띄우면 출혈 피해가 한 번 더 들어감 (사용자 지정)
  //   적 옵션 bleedImmune = 출혈이 쌓이자마자 재생 (리안 15세 산의 주인)
  // 죽거나 죽이거나 (사용자 지정): 쓰러뜨릴 수 있는 적은 공격 횟수 제한 없이 한쪽이 쓰러질 때까지 (실제로는 endlessAttacks 번까지 생성)
  //   제외: immune(피해 없음)·rescue(난입 연출)·hideHp(체력 ???)·art 'none'(버텨내기 시험) · 적 옵션 endless: false 로 개별 제외
  endless: true, endlessAttacks: 600,
  // 흑마법사 공격 패턴 (사용자 지정 2026-11-26): 매우 느린 공격 2~3번 → 가운데를 둘러싼 원 위에 1·2·4·8개가 차례로 '촤라락' (한 묶음 안 0.2초 간격) → 처음부터 반복
  //   적 옵션 mageWaves: true 로 사용. slowAp = 느린 공격의 고리가 줄어드는 시간(ms) · r = 원 반지름 · cx/cy = 원 중심 (전투 화면 720×420 기준)
  mageWaves: { slow: [2, 3], slowAp: 2000, slowGap: [2300, 2700], waves: [1, 2, 4, 8], inGap: 200, waveGap: 1300, toWaves: 1500, toSlow: 1600, cx: 360, cy: 228, r: 125 },
  // 출혈 쌓이는 양 (사용자 지정 2026-11-21: 막으면 0.5, Just Guard 는 석궁 포함 1 — 예전 1 / 2 는 너무 후함)
  hunt: { atkBase: 3, atkPerAgi: 0.25, perStack: 1.5, maxStacks: 6, stack: { perfect: 0.5, great: 0.5, good: 0 }, crossbow: 0.5 },
  windows: { perfect: 40, great: 90, good: 150 },
  background: '/img/bg_forest.jpg',  // 전투 배경 그림 (적마다 bg 로 따로 정할 수도 있음). 없으면 도형으로 그림
  mult: { perfect: 1.5, great: 1.0, good: 0.5 },
  // 막아도 받는 피해 (적에 guardDamage 를 따로 안 적었을 때의 기본 규칙 · 사용자 지정)
  //   Miss  = 피격 피해 × 75%,  Guard = 피격의 50%,  Just Guard = 0   (예전: Miss 50% · Guard 25%)
  //   둘 다 민첩성 5당 1씩 줄어듦 (0 아래로는 안 내려감)
  // 적 피해(damage)는 이 너프와 함께 전부 ×0.8 (guardDamage 를 따로 적은 grizzly·elm_wolf 제외 · 사용자 지정 2026-11-22: '피해 20%씩만 까자')
  guardRule: { good: 0.75, great: 0.5, agiPer: 5 },   // 사용자 지정 2026-11-22: Guard 25% → 50%, Miss 50% → 75% (가드 성능을 죽여 실수 리스크를 줄임 — '대의를 위한 희생')
  enemies: {
    // 바르크 15세 숲: 늑대 4연전 (HP는 이어짐, 갈수록 빨라짐)
    // noHitChain = 노히트(전부 Just Guard 로 승리) 마릿수 칭호 묶음 (NOHIT_CHAINS)
    wolf1: { name: '굶주린 늑대', art: 'wolf', image: '/img/wolf.png', hp: 55, damage: 13, attacks: 9, approach: 1150, gapMin: 750, gapMax: 1300, lethal: false, loseHp: 12,
             noHitChain: 'barck_wolves' },
    wolf2: { name: '쫓아온 늑대', art: 'wolf', image: '/img/wolf.png', hp: 55, damage: 13, attacks: 9, approach: 1050, gapMin: 700, gapMax: 1200, lethal: false, loseHp: 10,
             noHitChain: 'barck_wolves' },
    wolf3: { name: '사나운 늑대', art: 'wolf', image: '/img/wolf.png', hp: 60, damage: 14, attacks: 10, approach: 950, gapMin: 650, gapMax: 1100, lethal: false, loseHp: 8,
             noHitChain: 'barck_wolves' },
    wolf4: { name: '늑대 우두머리', art: 'wolf', image: '/img/wolf.png', hp: 75, damage: 16, attacks: 11, approach: 900, gapMin: 600, gapMax: 1050, lethal: false, loseHp: 6,
             noHitChain: 'barck_wolves' },
    // 패배 확정 전투: 막아도 피해가 들어오고, HP가 0이 되는 순간 일리치가 난입
    grizzly: { name: '그리즐리 베어', art: 'bear', image: '/img/grizzly.png', hp: 999, hideHp: true, damage: 40, attacks: 100, approach: 950, gapMin: 650, gapMax: 1100,
               guardDamage: { perfect: 1, great: 10, good: 20 }, lethal: false, rescue: true, rescueName: '일리치', finale: 10 },
    // 엘름 15세: 막대기로 늑대와 싸움. 피해를 못 주고 막아도 조금씩 다침 → 끝내 막을 수 없는 일격(finale) 순간 마나 각성
    elm_wolf: { name: '굶주린 늑대', art: 'wolf', image: '/img/wolf.png', hp: 60, damage: 8, attacks: 60, approach: 1100, gapMin: 750, gapMax: 1250,
                guardDamage: { perfect: 2, great: 3, good: 5 }, immune: true, lethal: false,
                rescue: true, finale: 10, rescueStyle: 'flame', rescueTitle: '', rescueName: '',  // 글자 없이 불꽃만
                rescueLog: '쓰러지기 직전, 몸속 깊은 곳에서 마나가 터져 나왔다',
                titleOn: { perfect: 15, title: '막대기로 이게 된다고?' } },   // Just Guard 15번 이상이면 칭호
    // 엘름 → 왕도 가는 길: 마나를 각성한 뒤 첫 전투 (마법진). 쓰러뜨려야 승리, 져도 죽지 않음
    road_grizzly: { name: '그리즐리 베어', art: 'bear', image: '/img/grizzly.png', hp: 300, damage: 19, attacks: 40, approach: 950, gapMin: 650, gapMax: 1100,
                    mustKill: true, lethal: false, loseHp: 10 },
    // 리안 15세 (사냥꾼 출혈 전투) — 사용자 스토리라인, 숫자는 내가 정함
    rian_wolf1: { name: '어린 늑대', art: 'wolf', image: '/img/wolf.png', hp: 45, damage: 10, attacks: 12, approach: 1150, gapMin: 800, gapMax: 1300, lethal: false, loseHp: 10 },   // 14세 첫 사냥 (출혈 튜토리얼)
    rian_wolf2: { name: '굶주린 늑대', art: 'wolf', image: '/img/wolf.png', hp: 55, damage: 13, attacks: 12, approach: 1050, gapMin: 700, gapMax: 1200, lethal: false, loseHp: 10 },
    rian_wolf3: { name: '늑대 우두머리', art: 'wolf', image: '/img/wolf.png', hp: 75, damage: 16, attacks: 14, approach: 950, gapMin: 650, gapMax: 1100, lethal: false, loseHp: 8 },
    // 산의 주인: 버텨내기 (출혈 면역 · 끝까지 버티면 승리, 쓰러지기 직전 알파 난입)
    // 체력 1500 이 보이고 반격 피해도 들어가지만, 맞는 즉시 재생해 가득 참(regenFull) — 아예 못 이긴다는 느낌 (사용자 지정 2026-11-23)
    // 그림: 사용자 AI 이미지(1번)를 잘라 화면 전체 배경으로 씀 (art none = 적 그림 없이 배경만)
    rian_lord: { name: '타락한 산의 주인', art: 'none', bg: '/img/bg_lord.jpg', hp: 1500, damage: 21, attacks: 24, approach: 950, gapMin: 650, gapMax: 1100,
                 regenFull: true, bleedImmune: true, lethal: false, rescue: true, rescueName: '알파',
                 winTitle: '안아프게 맞기' },   // 24번 다 막고 버티면 캐릭터 칭호 (사용자 지정 2026-11-23)
    rian_beast1: { name: '미쳐 버린 마물', art: 'wolf', image: '/img/wolf.png', hp: 70, damage: 14, attacks: 14, approach: 950, gapMin: 650, gapMax: 1100, lethal: false, loseHp: 10 },
    rian_beast2: { name: '거대한 마물', art: 'bear', image: '/img/grizzly.png', hp: 90, damage: 18, attacks: 18, approach: 950, gapMin: 650, gapMax: 1100, lethal: false, loseHp: 10 },
    // 오크 (사용자 AI 이미지 4장 중 2번 · 배경 제거) — 왕도 첫 의뢰(st_cap_2_orc). 사용자: 체력 400 (싸우는 맛) · 피해 14 · 공격 45번 (주 능력치 20~33 기준으로 맞춤)
    orc: { name: '오크', art: 'bear', image: '/img/orc.png', spriteH: 205, hp: 400, damage: 11, attacks: 45, approach: 1000, gapMin: 700, gapMax: 1150, lethal: false, loseHp: 10 },
    // 왕도 1차 이야기 · 사령 동굴 — 지면 쓰러짐 → 세실의 브로치로 귀환 (사용자 지정: 져도 3번까진 스펙 올려서 다시 오라), 다시 이어가면 그 전투부터 (그림: 사용자 AI 이미지 2026-11-21, 배경 제거 · 파일이 없으면 화면이 직접 그림)
    skeleton: { name: '스켈레톤', art: 'skeleton', image: '/img/skeleton.png', spriteH: 205, hp: 150, damage: 6, attacks: 14, approach: 1050, gapMin: 700, gapMax: 1200, lethal: true },
    dark_mage: { name: '흑마법사', art: 'mage', image: '/img/dark_mage.png', spriteH: 210, mageWaves: true, hp: 600, damage: 21, attacks: 40, approach: 900, gapMin: 600, gapMax: 1050, lethal: true },
    // 승급 시험 (임시 · 모든 직업 공통). 반드시 쓰러뜨려야 합격, 져도 죽지 않음
    exam1: { name: '토벌 대상 · 거대 늑대', art: 'wolf', image: '/img/wolf.png', hp: 120, damage: 19, attacks: 22, approach: 900, gapMin: 600, gapMax: 1050,
             mustKill: true, lethal: false, loseHp: 10 },
    // 사냥꾼 1차 승급 (사용자 지정): 돌연변이 그리즐리 베어 — 반격 피해는 전부 1 고정, 출혈로만 잡아야 함
    exam_scout1: { name: '돌연변이 그리즐리 베어', art: 'bear', image: '/img/grizzly.png', hp: 240, damage: 22, attacks: 40, approach: 880, gapMin: 600, gapMax: 1000,
                   counterFixed: 1, mustKill: true, lethal: false, loseHp: 10 },
    // 금 등급 메인 스토리 1장 (사용자 흐름 2026-11-22): 보호소 경비병 (쉽게 이김) → 기사 (못 이김 · 쓰러지기 직전 길드원들 난입)
    //   그림 파일이 없으면 combat.js 가 직접 그림 (art 'soldier'·'knight') · /img/guard.png·/img/knight.png 를 넣으면 그 그림 · 수치는 내가 정함
    guard: { bg: '/img/vn/alley.jpg', name: '보호소 경비병', art: 'soldier', image: '/img/guard.png', spriteH: 205, hp: 140, damage: 10, attacks: 0, approach: 1050, gapMin: 700, gapMax: 1200, lethal: false, loseHp: 10 },
    knight: { bg: '/img/vn/alley.jpg', name: '기사', art: 'knight', image: '/img/knight.png', spriteH: 215, hp: 999, hideHp: true, damage: 36, attacks: 100, approach: 820, gapMin: 560, gapMax: 980,
              guardDamage: { perfect: 2, great: 14, good: 24 }, lethal: false, rescue: true, rescueName: '길드원들' },
    // 전사 2차 승급 (사용자 지정 2026-11-22): 흑마법사 · 체력 700 (나머지 수치는 사령 동굴 흑마법사와 같음)
    exam_dark_mage: { name: '흑마법사', art: 'mage', image: '/img/dark_mage.png', spriteH: 210, mageWaves: true, hp: 700, damage: 21, attacks: 40, approach: 900, gapMin: 600, gapMax: 1050,
                      mustKill: true, lethal: false, loseHp: 10 },
    exam2: { name: '던전의 수호자', art: 'bear', image: '/img/grizzly.png', hp: 260, damage: 26, attacks: 30, approach: 820, gapMin: 550, gapMax: 950,
             mustKill: true, lethal: false, loseHp: 10 },
    // 1인 격파용 (협동용보다 약함)
    // 공격 횟수는 체력과 공격력에 맞춰 자동 (SOLO.attackSlack)
    solo_grizzly: { name: '오크', art: 'bear', image: '/img/orc.png', spriteH: 205, hp: 600, damage: 19, attacks: 0, approach: 980, gapMin: 680, gapMax: 1150,
                    mustKill: true, lethal: false, loseHp: 10 },
    // 보스 테스트: 평범한 공격 5번 → 20연타, 반복 (공격 75번 = 3바퀴)
    test_boss: { name: '[테스트] 보스', art: 'bear', image: '/img/grizzly.png', hp: 450, damage: 16, attacks: 75, approach: 950,
                 pattern: [
                   { count: 5,  gapMin: 750, gapMax: 1150 },
                   { count: 20, gapMin: 273, gapMax: 338, pause: 600 },  // 간격: 처음 210~260 → 1.3배 너프 (같은 자리 연타 sameSpot 은 재미없어서 뺌)
                 ],
                 mustKill: true, lethal: false, loseHp: 10 },
    // 마법사 승급 시험: 적 없이 패턴만 (art 'none'). 공격을 끝까지 버티면 합격 (mustKill 아님)
    exam_mage1: { name: '마탑의 시험', art: 'none', bg: 'arcane', hp: 1, damage: 16, attacks: 15, approach: 950, immune: true,  // attacks 30 → 15 (사용자: 절반으로)
                  pattern: [{ count: 3, gapMin: 700, gapMax: 1000 }, { count: 4, gapMin: 380, gapMax: 460, pause: 500 }],
                  manaShield: 0.5, lethal: false, loseHp: 10, winText: '합격',
                  clearLog: '시험관이 쏟아 낸 마법을 끝까지 막아 냈다', failLog: '시험관의 마법을 끝까지 막아 내지 못했다' },
    exam_mage2: { name: '폭주하는 마력', art: 'none', bg: 'arcane', hp: 1, damage: 22, attacks: 21, approach: 880, immune: true,  // attacks 42 → 21
                  pattern: [{ count: 3, gapMin: 650, gapMax: 900 }, { count: 6, gapMin: 300, gapMax: 360, pause: 500 }],
                  manaShield: 0.5, lethal: false, loseHp: 10, winText: '합격',
                  clearLog: '폭주하는 마력을 끝까지 다스려 냈다', failLog: '폭주하는 마력에 휩쓸려 버렸다' },
    // 협동 의뢰. hp 는 COOP.quests 의 totalHp ÷ 인원수, 공격 횟수는 자기 몫과 공격력에 맞춰 자동으로 정해짐
    solo_dark_mage: { name: '흑마법사', art: 'mage', image: '/img/dark_mage.png', spriteH: 210, mageWaves: true, hp: 900, damage: 21, attacks: 0, approach: 930, gapMin: 640, gapMax: 1100,
                      mustKill: true, lethal: false, loseHp: 10 },
    coop_dark_mage: { name: '흑마법사', art: 'mage', image: '/img/dark_mage.png', spriteH: 210, mageWaves: true, hp: 1800, damage: 21, attacks: 0, approach: 900, gapMin: 620, gapMax: 1080,
                      mustKill: true, lethal: false, loseHp: 10 },
    coop_grizzly: { name: '오크 우두머리', art: 'bear', image: '/img/orc.png', spriteH: 215, hp: 600, damage: 22, attacks: 0, approach: 950, gapMin: 650, gapMax: 1100,
                    mustKill: true, lethal: false, loseHp: 10 },
  },
};

// 판정 성공률 = 50 + (능력치 - 난이도) × 이 값, 최소·최대 제한
// failGain: 판정에 실패해도 그 판정 능력치가 이만큼 오름 (실패에서도 배운다. 0이면 끔)
//   → 지능이 낮아 지능 판정에 계속 실패하고, 그래서 지능이 영영 안 오르는 악순환을 막음
const CHECK = { perPoint: 5, min: 10, max: 95, failGain: 1 };

module.exports = {
  SMITHY, ALICE_AGE_GAP, NOHIT_CHAINS, EQUIP_SLOTS, EQUIPMENT,
  STATS, SPECIAL_STATS, MAGIC_STATS, GENDER_WORDS, TITLES, START_AGE, ADULT_AGE, GROWTH_EVENT_CHANCE, EVENTS_PER_YEAR, BONUS_POINTS, CHILD_GOLD, START_GOLD, CAPITAL, ROUTINES,
  STORY, GOLD_BONUS, SEASON_EVENTS, JOB_CHANGE_KEEP_RANK, ACCOUNT_BONUSES, COOP, SOLO, TRAINING,
  RACES, VILLAGES, TAGS, JOBS, COMBAT, PROMOTION, DAILY_LINES, SEASONS, FATIGUE, REST, CHECK,
};
