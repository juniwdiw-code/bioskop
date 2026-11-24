// Menjalankan satu/lebih file .sql ke database Neon.
// Pemakaian: node --env-file=.env scripts/run-sql.js db/schema.sql db/seed.sql
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL belum diatur. Salin .env.example menjadi .env lalu isi.');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const run = (text) => (typeof sql.query === 'function' ? sql.query(text, []) : sql(text));

for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const statements = text.split(/;[ \t]*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean);
  for (const s of statements) await run(s);
  console.log(`OK  ${file} (${statements.length} perintah)`);
}
