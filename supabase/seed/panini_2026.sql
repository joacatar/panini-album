-- Ejecutar después de la migración inicial (SQL Editor o: supabase db seed)
INSERT INTO public.stickers (number, name, section, sticker_type) VALUES
(1, 'Logo FIFA', 'Intro', 'special'),
(2, 'Trofeo', 'Intro', 'shiny'),
(3, 'México 2026', 'Intro', 'normal'),
(4, 'USA 2026', 'Intro', 'normal'),
(5, 'Canadá 2026', 'Intro', 'normal'),
(6, 'Estadio 1', 'Estadios', 'normal'),
(7, 'Estadio 2', 'Estadios', 'normal'),
(8, 'Estadio 3', 'Estadios', 'normal'),
(9, 'Estadio 4', 'Estadios', 'normal'),
(10, 'Mascota', 'Mascotas', 'shiny')
ON CONFLICT (number) DO NOTHING;

-- Para el catálogo completo, usar el script: python backend/scripts/seed_stickers.py
