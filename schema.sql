-- 테스트용 버전 DB 구조 (v11: 추가 최대 HP)
-- 실행: mariadb -u gameuser -p -P 3307 game < schema.sql
-- 주의: 다시 실행하면 기존 데이터가 모두 지워집니다.

SET NAMES utf8mb4;

DROP TABLE IF EXISTS coop_members;
DROP TABLE IF EXISTS coop_rooms;
DROP TABLE IF EXISTS account_unlocks;
DROP TABLE IF EXISTS character_npcs;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS logs;
DROP TABLE IF EXISTS characters;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  login_id      VARCHAR(30)  NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE characters (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT          NOT NULL,
  slot_no       TINYINT      NOT NULL,
  name          VARCHAR(20)  NOT NULL UNIQUE,   -- 게시판 닉네임이 되므로 전체 중복 불가
  gender        VARCHAR(10)  NOT NULL,
  race          VARCHAR(20)  NOT NULL,
  origin        VARCHAR(30)  NOT NULL,            -- 태어난 마을
  tags          VARCHAR(100) NOT NULL,          -- 성격 태그, 쉼표로 구분
  intro         VARCHAR(200) NOT NULL DEFAULT '',

  -- 진행 단계: growth(성장기) → bonus(보너스 분배) → job(직업 선택) → adult(성인)
  phase         VARCHAR(10)  NOT NULL DEFAULT 'growth',
  age           INT          NOT NULL,
  year_no       INT          NOT NULL DEFAULT 0,  -- 성인 이후 몇 년차
  season        TINYINT      NOT NULL DEFAULT 0,  -- 0 봄, 1 여름, 2 가을, 3 겨울

  str           INT          NOT NULL DEFAULT 5,
  intel         INT          NOT NULL DEFAULT 5,
  agi           INT          NOT NULL DEFAULT 5,
  cha           INT          NOT NULL DEFAULT 5,
  luck          INT          NOT NULL DEFAULT 0,  -- 칭호 전용 특별 능력치 (행운)
  mana          INT          NOT NULL DEFAULT 0,  -- 마나 (마법사 이야기에서 얻음)
  hp            INT          NULL,                -- 현재 HP (NULL = 가득)
  hp_bonus      INT          NOT NULL DEFAULT 0,  -- 이벤트로 얻은 추가 최대 HP

  job           VARCHAR(20)  NULL,
  rank_level    TINYINT      NOT NULL DEFAULT 0,
  gold          INT          NOT NULL DEFAULT 0,
  fatigue       INT          NOT NULL DEFAULT 0,
  bonus_points  INT          NOT NULL DEFAULT 0,
  solo_count    INT          NOT NULL DEFAULT 0,  -- 특별 의뢰 완료 횟수 (협동 의뢰 개방 조건)
  coop_count    INT          NOT NULL DEFAULT 0,
  purchases     VARCHAR(500) NOT NULL DEFAULT '', -- 이번 계절 상점 구매 기록

  -- 이어하기용: 선택을 기다리는 이벤트와, 이미 본 성장기 이벤트 목록
  pending_event VARCHAR(40)  NULL,
  seen_events   TEXT         NOT NULL,
  story_done    VARCHAR(2000) NOT NULL DEFAULT '', -- 끝낸 메인 스토리 장
  routine       VARCHAR(40)  NULL,                -- 성장기 일상 (예: 장작 패기)
  event_queue   VARCHAR(500) NULL,                -- 그 해에 남은 사건 ID들
  records       TEXT         NOT NULL,           -- 획득한 칭호, 쉼표로 구분
  equipment     VARCHAR(255) NULL,               -- 장비 (v12) "weapon:ilyich_sword,..." · 비면 직업 기본 장비

  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_user_slot (user_id, slot_no),
  CONSTRAINT fk_char_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE logs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  character_id  INT          NOT NULL,
  label         VARCHAR(30)  NOT NULL,           -- 예: '8세', '1년차 봄'
  kind          VARCHAR(10)  NOT NULL,           -- daily, event, system
  text          TEXT         NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_logs_char (character_id, id),
  CONSTRAINT fk_log_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 게시판
CREATE TABLE IF NOT EXISTS posts (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  board         VARCHAR(10)  NOT NULL,            -- free(자유), quest(의뢰)
  character_id  INT          NULL,                -- 캐릭터가 사라지면 NULL
  author_name   VARCHAR(20)  NOT NULL,            -- 캐릭터가 사라져도 이름은 남김
  author_gone   VARCHAR(10)  NULL,                -- 故(사망) / 떠남(삭제)
  title         VARCHAR(80)  NOT NULL,
  body          TEXT         NOT NULL,
  comment_count INT          NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_posts_board (board, id),
  KEY idx_posts_char (character_id),
  CONSTRAINT fk_post_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comments (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  post_id       INT          NOT NULL,
  character_id  INT          NULL,
  author_name   VARCHAR(20)  NOT NULL,
  author_gone   VARCHAR(10)  NULL,
  body          VARCHAR(500) NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comments_post (post_id, id),
  CONSTRAINT fk_comment_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_comment_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 핵심 NPC · 계정 보너스
CREATE TABLE IF NOT EXISTS character_npcs (
  character_id  INT          NOT NULL,
  npc_id        VARCHAR(40)  NOT NULL,              -- data/npcs.csv 의 ID
  affinity      INT          NOT NULL DEFAULT 0,
  met_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (character_id, npc_id),
  CONSTRAINT fk_cnpc_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 계정에 영구히 남는 보너스 (캐릭터가 죽거나 삭제돼도 유지)
CREATE TABLE IF NOT EXISTS account_unlocks (
  user_id       INT          NOT NULL,
  unlock_id     VARCHAR(40)  NOT NULL,              -- data/content.js ACCOUNT_BONUSES 의 id
  character_name VARCHAR(20) NULL,                  -- 해금한 캐릭터
  unlocked_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, unlock_id),
  CONSTRAINT fk_unlock_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 협동 의뢰
CREATE TABLE IF NOT EXISTS coop_rooms (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  quest_id    VARCHAR(40)  NOT NULL,                 -- data/content.js COOP.quests 의 id
  leader_id   INT          NOT NULL,                 -- 방장 캐릭터
  status      VARCHAR(10)  NOT NULL DEFAULT 'open',  -- open 모집 중 / fighting 전투 중 / cleared 성공 / failed 실패
  round       INT          NOT NULL DEFAULT 0,       -- 몇 번째 도전인지
  share       INT          NOT NULL DEFAULT 0,       -- 이번 라운드 1인당 깎아야 할 체력
  is_private  TINYINT(1)   NOT NULL DEFAULT 0,       -- 1 = 비공개 (목록에 안 보이고 방 코드로만 입장)
  code        VARCHAR(10)  NULL,                     -- 비공개 방 코드
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at    DATETIME     NULL,
  KEY idx_coop_status (status, created_at),
  KEY idx_coop_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coop_members (
  room_id       INT          NOT NULL,
  character_id  INT          NOT NULL,
  state         VARCHAR(12)  NOT NULL DEFAULT 'joined', -- joined 대기 / fighting 내 차례 / won 성공 / lost 실패 / spectating 구경
  joined_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, character_id),
  KEY idx_coop_member_char (character_id),
  CONSTRAINT fk_coopm_room FOREIGN KEY (room_id) REFERENCES coop_rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_coopm_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
