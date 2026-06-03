-- Panini FIFA 2026 — esquema inicial
CREATE EXTENSION IF NOT EXISTS postgis;

-- Catálogo de láminas
CREATE TABLE public.stickers (
  id SERIAL PRIMARY KEY,
  number INT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL DEFAULT '',
  sticker_type TEXT NOT NULL DEFAULT 'normal' CHECK (sticker_type IN ('normal', 'shiny', 'special')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Perfiles (vinculados a auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  location GEOGRAPHY(POINT, 4326),
  search_radius_km INT NOT NULL DEFAULT 25 CHECK (search_radius_km BETWEEN 5 AND 200),
  avatar_url TEXT,
  profile_complete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX profiles_location_idx ON public.profiles USING GIST (location);

-- Colección por usuario
CREATE TABLE public.user_stickers (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sticker_id INT NOT NULL REFERENCES public.stickers(id) ON DELETE CASCADE,
  owned BOOLEAN NOT NULL DEFAULT false,
  duplicates INT NOT NULL DEFAULT 0 CHECK (duplicates >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sticker_id)
);

CREATE INDEX user_stickers_user_idx ON public.user_stickers (user_id);

-- Intercambios
CREATE TYPE public.trade_status AS ENUM (
  'pendiente', 'aceptado', 'coordinando', 'completado', 'cancelado'
);

CREATE TABLE public.trade_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status public.trade_status NOT NULL DEFAULT 'pendiente',
  offer_sticker_ids INT[] NOT NULL DEFAULT '{}',
  want_sticker_ids INT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (requester_id <> receiver_id)
);

CREATE INDEX trade_requests_requester_idx ON public.trade_requests (requester_id);
CREATE INDEX trade_requests_receiver_idx ON public.trade_requests (receiver_id);

CREATE TABLE public.trade_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES public.trade_requests(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX trade_messages_trade_idx ON public.trade_messages (trade_id);

-- Reseñas
CREATE TABLE public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES public.trade_requests(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trade_id, reviewer_id)
);

CREATE INDEX reviews_reviewee_idx ON public.reviews (reviewee_id);

-- Reportes
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vista pública de colección (sin PII)
CREATE OR REPLACE VIEW public.public_collections AS
SELECT
  p.id AS user_id,
  p.display_name,
  p.city,
  p.country,
  p.search_radius_km,
  p.avatar_url,
  COALESCE(
    array_agg(us.sticker_id) FILTER (WHERE us.duplicates > 0),
    '{}'
  ) AS duplicate_sticker_ids,
  COALESCE(
    array_agg(s.number) FILTER (WHERE us.duplicates > 0),
    '{}'
  ) AS duplicate_numbers,
  (
    SELECT COALESCE(array_agg(st.number), '{}')
    FROM public.stickers st
    LEFT JOIN public.user_stickers us2
      ON us2.sticker_id = st.id AND us2.user_id = p.id AND us2.owned = true
    WHERE us2.sticker_id IS NULL
  ) AS missing_numbers
FROM public.profiles p
LEFT JOIN public.user_stickers us ON us.user_id = p.id
LEFT JOIN public.stickers s ON s.id = us.sticker_id
WHERE p.profile_complete = true
GROUP BY p.id, p.display_name, p.city, p.country, p.search_radius_km, p.avatar_url;

-- Promedio de reseñas por usuario
CREATE OR REPLACE VIEW public.profile_ratings AS
SELECT
  reviewee_id AS user_id,
  ROUND(AVG(rating)::numeric, 1) AS avg_rating,
  COUNT(*)::int AS review_count
FROM public.reviews
GROUP BY reviewee_id;

-- Trigger: perfil al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1), 'Coleccionista')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Actualizar location desde lat/lng
CREATE OR REPLACE FUNCTION public.sync_profile_location()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_location_sync
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_location();

-- RLS
ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_stickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Stickers: lectura pública
CREATE POLICY stickers_select_all ON public.stickers FOR SELECT TO authenticated, anon USING (true);

-- Profiles
CREATE POLICY profiles_select_authenticated ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- User stickers
CREATE POLICY user_stickers_select_own ON public.user_stickers
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY user_stickers_select_others_duplicates ON public.user_stickers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY user_stickers_insert_own ON public.user_stickers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_stickers_update_own ON public.user_stickers
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_stickers_delete_own ON public.user_stickers
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Trades: participantes
CREATE POLICY trade_requests_select_participant ON public.trade_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = receiver_id);
CREATE POLICY trade_requests_insert_requester ON public.trade_requests
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = requester_id);
CREATE POLICY trade_requests_update_participant ON public.trade_requests
  FOR UPDATE TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = receiver_id);

-- Messages: participantes del trade
CREATE POLICY trade_messages_select ON public.trade_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trade_requests t
      WHERE t.id = trade_id
        AND (t.requester_id = auth.uid() OR t.receiver_id = auth.uid())
    )
  );
CREATE POLICY trade_messages_insert ON public.trade_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.trade_requests t
      WHERE t.id = trade_id
        AND (t.requester_id = auth.uid() OR t.receiver_id = auth.uid())
    )
  );

-- Reviews: lectura pública; escritura propia tras trade completado
CREATE POLICY reviews_select_all ON public.reviews
  FOR SELECT TO authenticated USING (true);
CREATE POLICY reviews_insert_own ON public.reviews
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = reviewer_id);

-- Reports
CREATE POLICY reports_insert_own ON public.reports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);

GRANT SELECT ON public.public_collections TO authenticated;
GRANT SELECT ON public.profile_ratings TO authenticated, anon;

-- Realtime (opcional): habilitar trade_messages en Dashboard → Database → Publications
