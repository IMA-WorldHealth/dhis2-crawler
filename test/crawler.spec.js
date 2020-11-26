const test = require('ava');

const crawler = require('..');

test('pass', t => {
  t.is(typeof crawler, 'function')
});

