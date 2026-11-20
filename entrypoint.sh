#!/bin/sh
set -e
until node -e "const{Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL,ssl:process.env.DB_SSL!=='false'?{rejectUnauthorized:false}:false});c.connect().then(()=>c.end()).then(()=>process.exit(0)).catch(()=>process.exit(1));" ; do
  echo "waiting for database..."
  sleep 2
done
node dist/db/migrate.js
node dist/db/seed.js
exec node dist/server.js