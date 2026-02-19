// SQLite 不需要迁移工具，schema 在首次连接时自动初始化
// 此脚本保留以兼容 package.json 中的 db:migrate:core / db:migrate:market 脚本

const role = (process.argv[2] || '').trim();
console.log(`[db] SQLite migration skipped${role ? ` (role=${role})` : ''}`);
