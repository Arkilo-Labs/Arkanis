exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.addColumn('ai_provider_definitions', {
        remark: { type: 'text' },
    });
};

exports.down = (pgm) => {
    pgm.dropColumn('ai_provider_definitions', 'remark');
};

