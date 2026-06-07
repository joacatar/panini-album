-- Coca-Cola x Panini (12 láminas exclusivas, números globales 981-992)
INSERT INTO public.stickers (number, code, name, section, team_code, team_name, team_slot, sticker_kind, sticker_type, display_order) VALUES
(981, 'COC1', 'Lamine Yamal', 'Coca-Cola x Panini', 'COC', 'Coca-Cola x Panini', 1, 'coca_cola', 'special', 980),
(982, 'COC2', 'Joshua Kimmich', 'Coca-Cola x Panini', 'COC', 'Coca-Cola x Panini', 2, 'coca_cola', 'special', 981),
(983, 'COC3', 'Virgil van Dijk', 'Coca-Cola x Panini', 'COC', 'Coca-Cola x Panini', 3, 'coca_cola', 'special', 982),
(984, 'COC4', 'Antonee Robinson', 'Coca-Cola x Panini', 'COC', 'Coca-Cola x Panini', 4, 'coca_cola', 'special', 983),
(985, 'COC5', 'Alphonso Davies', 'Coca-Cola x Panini', 'COC', 'Coca-Cola x Panini', 5, 'coca_cola', 'special', 984),
(986, 'COC6', 'Lautaro Martínez', 'Coca-Cola x Panini', 'COC', 'Coca-Cola x Panini', 6, 'coca_cola', 'special', 985),
(987, 'COC7', 'Harry Kane', 'Coca-Cola x Panini', 'COC', 'Coca-Cola x Panini', 7, 'coca_cola', 'special', 986),
(988, 'COC8', 'Edson Álvarez', 'Coca-Cola x Panini', 'COC', 'Coca-Cola x Panini', 8, 'coca_cola', 'special', 987),
(989, 'COC9', 'Weston McKennie', 'Coca-Cola x Panini', 'COC', 'Coca-Cola x Panini', 9, 'coca_cola', 'special', 988),
(990, 'COC10', 'Jefferson Lerma', 'Coca-Cola x Panini', 'COC', 'Coca-Cola x Panini', 10, 'coca_cola', 'special', 989),
(991, 'COC11', 'Santiago Giménez', 'Coca-Cola x Panini', 'COC', 'Coca-Cola x Panini', 11, 'coca_cola', 'special', 990),
(992, 'COC12', 'Gabriel Magalhães', 'Coca-Cola x Panini', 'COC', 'Coca-Cola x Panini', 12, 'coca_cola', 'special', 991)
ON CONFLICT (number) DO UPDATE SET
  code = EXCLUDED.code, name = EXCLUDED.name, section = EXCLUDED.section,
  team_code = EXCLUDED.team_code, team_name = EXCLUDED.team_name,
  team_slot = EXCLUDED.team_slot, sticker_kind = EXCLUDED.sticker_kind,
  sticker_type = EXCLUDED.sticker_type, display_order = EXCLUDED.display_order;
