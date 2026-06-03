-- Catálogo por equipo (FWC + selecciones)
ALTER TABLE public.stickers
  ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS team_code TEXT NOT NULL DEFAULT 'FWC',
  ADD COLUMN IF NOT EXISTS team_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS team_slot INT,
  ADD COLUMN IF NOT EXISTS sticker_kind TEXT NOT NULL DEFAULT 'jugador',
  ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS stickers_display_order_idx ON public.stickers (display_order);
CREATE INDEX IF NOT EXISTS stickers_team_code_idx ON public.stickers (team_code);

COMMENT ON COLUMN public.stickers.team_code IS 'FWC, MEX, RSA, etc.';
COMMENT ON COLUMN public.stickers.sticker_kind IS 'fwc, escudo, jugador, foto_equipo';
