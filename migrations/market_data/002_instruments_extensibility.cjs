exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.sql(`ALTER TABLE instruments ADD COLUMN IF NOT EXISTS asset_class text NOT NULL DEFAULT 'crypto'`);
    pgm.sql(`ALTER TABLE instruments ADD COLUMN IF NOT EXISTS venue text`);
    pgm.sql(`ALTER TABLE instruments ADD COLUMN IF NOT EXISTS metadata jsonb`);

    pgm.sql(`CREATE INDEX IF NOT EXISTS instruments_asset_class_idx ON instruments(asset_class)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS instruments_venue_idx ON instruments(venue)`);
};

exports.down = (pgm) => {
    pgm.sql(`DROP INDEX IF EXISTS instruments_asset_class_idx`);
    pgm.sql(`DROP INDEX IF EXISTS instruments_venue_idx`);

    pgm.sql(`ALTER TABLE instruments DROP COLUMN IF EXISTS metadata`);
    pgm.sql(`ALTER TABLE instruments DROP COLUMN IF EXISTS venue`);
    pgm.sql(`ALTER TABLE instruments DROP COLUMN IF EXISTS asset_class`);
};

