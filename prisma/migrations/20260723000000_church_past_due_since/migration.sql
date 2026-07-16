-- Marca quando a igreja entrou em past_due; base da janela de graça da página pública de doação.
ALTER TABLE "churches" ADD COLUMN "past_due_since" TIMESTAMP(3);
