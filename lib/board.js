// ============================================================
//  게시판 (자유게시판, 의뢰게시판)
//  글쓴이는 계정이 아니라 "캐릭터"입니다. 닉네임 = 캐릭터 이름.
// ============================================================
const db = require('../db');

const BOARDS = {
  free:  { name: '자유게시판', desc: '캐릭터의 시점으로 나누는 이야기' },
  quest: { name: '의뢰게시판', desc: '함께 의뢰를 갈 동료를 찾는 곳' },
};
const PAGE_SIZE = 20;

const boardKey = b => (BOARDS[b] ? b : 'free');

// 캐릭터가 죽거나 삭제되기 직전에 호출 → 글은 남기고 표시만 바꿈
async function markAuthorGone(characterId, mark) {
  await db.query('UPDATE posts SET author_gone = ? WHERE character_id = ?', [mark, characterId]);
  await db.query('UPDATE comments SET author_gone = ? WHERE character_id = ?', [mark, characterId]);
}

// 글쓴이 표시용 정보(직업·등급)를 함께 가져오는 조건
const AUTHOR_COLS = 'ch.job AS author_job, ch.rank_level AS author_rank, ch.phase AS author_phase';

async function listPosts(board, page) {
  const p = Math.max(1, Number(page) || 1);
  const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM posts WHERE board = ?', [board]);
  const [rows] = await db.query(
    `SELECT p.id, p.title, p.author_name, p.author_gone, p.character_id, p.comment_count, p.created_at, ${AUTHOR_COLS}
       FROM posts p LEFT JOIN characters ch ON ch.id = p.character_id
      WHERE p.board = ? ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    [board, PAGE_SIZE, (p - 1) * PAGE_SIZE]);
  return { posts: rows, page: p, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total };
}

async function getPost(id) {
  const [rows] = await db.query(
    `SELECT p.*, ${AUTHOR_COLS}, ch.user_id AS author_user
       FROM posts p LEFT JOIN characters ch ON ch.id = p.character_id WHERE p.id = ?`, [id]);
  if (!rows.length) return null;
  const [comments] = await db.query(
    `SELECT c.*, ${AUTHOR_COLS}, ch.user_id AS author_user
       FROM comments c LEFT JOIN characters ch ON ch.id = c.character_id
      WHERE c.post_id = ? ORDER BY c.id ASC`, [id]);
  return { post: rows[0], comments };
}

function validatePost(input) {
  const title = String(input.title || '').trim();
  const body = String(input.body || '').trim();
  if (!title) return { error: '제목을 적어 주세요.' };
  if (title.length > 80) return { error: '제목은 80자까지예요.' };
  if (!body) return { error: '내용을 적어 주세요.' };
  if (body.length > 5000) return { error: '내용은 5000자까지예요.' };
  return { title, body };
}

async function createPost(board, character, input) {
  const v = validatePost(input);
  if (v.error) return v;
  const [r] = await db.query(
    'INSERT INTO posts (board, character_id, author_name, title, body) VALUES (?, ?, ?, ?, ?)',
    [board, character.id, character.name, v.title, v.body]);
  return { id: r.insertId };
}

async function addComment(postId, character, input) {
  const body = String(input.body || '').trim();
  if (!body) return { error: '댓글 내용을 적어 주세요.' };
  if (body.length > 500) return { error: '댓글은 500자까지예요.' };
  await db.query('INSERT INTO comments (post_id, character_id, author_name, body) VALUES (?, ?, ?, ?)',
    [postId, character.id, character.name, body]);
  await db.query('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?', [postId]);
  return {};
}

// 내 계정의 캐릭터가 쓴 글·댓글만 지울 수 있음
async function deletePost(postId, userId) {
  const [r] = await db.query(
    'DELETE p FROM posts p JOIN characters ch ON ch.id = p.character_id WHERE p.id = ? AND ch.user_id = ?', [postId, userId]);
  return r.affectedRows > 0;
}

async function deleteComment(commentId, userId) {
  const [rows] = await db.query(
    'SELECT c.post_id FROM comments c JOIN characters ch ON ch.id = c.character_id WHERE c.id = ? AND ch.user_id = ?', [commentId, userId]);
  if (!rows.length) return null;
  await db.query('DELETE FROM comments WHERE id = ?', [commentId]);
  await db.query('UPDATE posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = ?', [rows[0].post_id]);
  return rows[0].post_id;
}

async function recentPostsBy(characterId, limit = 5) {
  const [rows] = await db.query(
    'SELECT id, board, title, comment_count, created_at FROM posts WHERE character_id = ? ORDER BY id DESC LIMIT ?', [characterId, limit]);
  return rows;
}

module.exports = {
  BOARDS, boardKey, markAuthorGone,
  listPosts, getPost, createPost, addComment, deletePost, deleteComment, recentPostsBy,
};
