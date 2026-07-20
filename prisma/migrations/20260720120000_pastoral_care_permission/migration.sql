-- Novo valor precisa ser adicionado em uma migração isolada: o Postgres não
-- permite usar um valor de enum recém-criado na mesma transação que o cria.
ALTER TYPE "ChurchPermission" ADD VALUE IF NOT EXISTS 'pastoral_care';
