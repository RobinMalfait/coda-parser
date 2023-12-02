import * as path from 'path'
import { it, expect } from 'vitest'
import { parse } from '.'

import { readFile } from 'fs/promises'

it('should parse the header', () => {
  expect(
    parse(
      '0000018011520105        0938409934CODELICIOUS               GEBABEBB   09029308273 00001          984309          834080       2'
    ).header
  ).toMatchInlineSnapshot(`
    {
      "account": {
        "bic": "GEBABEBB",
        "identification_number": "09029308273",
        "name": "CODELICIOUS",
      },
      "application_code": "05",
      "bank_identification_number": "201",
      "date": 2015-01-18T00:00:00.000Z,
      "duplicate": false,
      "external_application_code": "00001",
      "file_reference": "0938409934",
      "record_identification": "0",
      "related_reference": "834080",
      "transaction_reference": "984309",
      "version": 2,
    }
  `)
})

it('should parse the old balance (#1)', () => {
  expect(
    parse(
      '10155001548226815 EUR0BE                  0000000004004100241214CODELICIOUS               PROFESSIONAL ACCOUNT               255'
    ).balance.old
  ).toMatchInlineSnapshot(`
    {
      "account": {
        "country": "BE",
        "currency": "EUR",
        "description": "PROFESSIONAL ACCOUNT",
        "extension_zone": "",
        "name": "CODELICIOUS",
        "number": "001548226815",
        "qualification_code": "0",
        "type": 0,
        "type_description": "Belgian account number",
      },
      "balance": 4004100,
      "coda_sequence_number": "255",
      "date": 2014-12-24T00:00:00.000Z,
      "record_identification": "1",
      "sequence_number": "155",
    }
  `)
})

it('should parse the old balance (#2)', () => {
  expect(
    parse(
      '13155001548226815 EUR0BE                  0000000004004100241214CODELICIOUS               PROFESSIONAL ACCOUNT               255'
    ).balance.old
  ).toMatchInlineSnapshot(`
    {
      "account": {
        "currency": "",
        "description": "PROFESSIONAL ACCOUNT",
        "name": "CODELICIOUS",
        "number": "001548226815 EUR0BE",
        "type": 3,
        "type_description": "IBAN of the foreign account number",
      },
      "balance": 4004100,
      "coda_sequence_number": "255",
      "date": 2014-12-24T00:00:00.000Z,
      "record_identification": "1",
      "sequence_number": "155",
    }
  `)
})

it('should parse information 3.1 (#1)', () => {
  expect(
    parse(
      '31000100010007500005482        004800001001BVBA.BAKKER PIET                                                                  1 0'
    ).information
  ).toMatchInlineSnapshot(`
    [
      {
        "article_code": "1",
        "communication": {
          "address": "",
          "identification_code": "",
          "locality": "",
          "name": "BVBA.BAKKER PIET",
        },
        "communication_type": "structured",
        "detail_sequence": "0001",
        "record_identification": "3",
        "reference_number": "0007500005482",
        "sequence": "0001",
        "transaction_code": {
          "category": "000",
          "category_description": "Net amount",
          "family": "04",
          "family_description": "Cards",
          "transaction": "80",
          "transaction_description": "<Unknown>",
          "type": "0",
        },
      },
    ]
  `)
})

it('should parse information 3.1 (#2)', () => {
  expect(
    parse(
      '31000100073403076534383000143  335370000ekeningING Plus BE12 3215 1548 2121 EUR Compte à vue BE25 3215 2158 2315             0 1'
    ).information
  ).toMatchInlineSnapshot(`
    [
      {
        "article_code": "1",
        "communication": "ekeningING Plus BE12 3215 1548 2121 EUR Compte à vue BE25 3215 2158 2315",
        "communication_type": "unstructured",
        "detail_sequence": "0007",
        "record_identification": "3",
        "reference_number": "3403076534383000143",
        "sequence": "0001",
        "transaction_code": {
          "category": "000",
          "category_description": "Net amount",
          "family": "35",
          "family_description": "Closing (periodical settlements for interest, costs, ...)",
          "transaction": "37",
          "transaction_description": "Costs",
          "type": "3",
        },
      },
    ]
  `)
})

it('should parse information 3.2', () => {
  expect(
    parse(
      '3200010001MAIN STREET 928                    5480 SOME CITY                                                                  0 0'
    ).information
  ).toMatchInlineSnapshot(`
    [
      {
        "article_code": "2",
        "communication": "MAIN STREET 928 5480 SOME CITY",
        "detail_sequence": "0001",
        "record_identification": "3",
        "sequence": "0001",
      },
    ]
  `)
})

it('should parse information 3.3', () => {
  expect(
    parse(
      '3300010001SOME INFORMATION ABOUT THIS TRANSACTION                                                                            0 0'
    ).information
  ).toMatchInlineSnapshot(`
    [
      {
        "article_code": "3",
        "communication": "SOME INFORMATION ABOUT THIS TRANSACTION",
        "detail_sequence": "0001",
        "record_identification": "3",
        "sequence": "0001",
      },
    ]
  `)
})

it('should parse message 4 (#1)', () => {
  expect(
    parse(
      '4 00010005                      THIS IS A PUBLIC MESSAGE                                                                       0'
    ).free_communications
  ).toMatchInlineSnapshot(`
    [
      {
        "detail_sequence": "0005",
        "record_identification": "4",
        "sequence": "0001",
        "text": "THIS IS A PUBLIC MESSAGE",
      },
    ]
  `)
})

it('should parse message 4 (#2)', () => {
  expect(
    parse(
      '4 00020000                                              ACCOUNT INFORMATION                                                    1'
    ).free_communications
  ).toMatchInlineSnapshot(`
    [
      {
        "detail_sequence": "0000",
        "record_identification": "4",
        "sequence": "0002",
        "text": "ACCOUNT INFORMATION",
      },
    ]
  `)
})

it('should parse the new balance', () => {
  expect(
    parse(
      '8225001548226815 EUR0BE                  1000000500012100120515                                                                0'
    ).balance.new
  ).toMatchInlineSnapshot(`
    {
      "account": {},
      "balance": -500012.1,
      "date": 2015-05-12T00:00:00.000Z,
      "link_code": "0",
      "record_identification": "8",
      "sequence_number": "225",
    }
  `)
})

it('should parse movement 2.1', () => {
  expect(
    parse(
      '21000100000001200002835        0000000001767820251214001120000112/4554/46812   813                                 25121421401 0'
    ).movements
  ).toMatchInlineSnapshot(`
    [
      {
        "amount": 1767.82,
        "article_code": "1",
        "communication": "112/4554/46812 813",
        "communication_type": "unstructured",
        "detail_sequence": "0000",
        "entry_date": 2014-12-25T00:00:00.000Z,
        "globalisation_code": "0",
        "record_identification": "2",
        "reference_number": "0001200002835",
        "sequence": "0001",
        "sequence_number": "214",
        "transaction_code": {
          "category": "000",
          "category_description": "Net amount",
          "family": "01",
          "family_description": "Domestic or local SEPA credit transfers",
          "transaction": "12",
          "transaction_description": "<Unknown>",
          "type": "0",
        },
        "value_date": 2014-12-25T00:00:00.000Z,
      },
    ]
  `)
})

it('should parse movement 2.2', () => {
  expect(
    parse(
      '2200010000  ANOTHER MESSAGE                                           54875                       GEBCEEBB                   1 0'
    ).movements
  ).toMatchInlineSnapshot(`
    [
      {
        "article_code": "2",
        "bic": "GEBCEEBB",
        "category_purpose": "",
        "communication": "ANOTHER MESSAGE",
        "customer_reference": "54875",
        "detail_sequence": "0000",
        "purpose": "",
        "r_reason": "",
        "r_transaction_type": "",
        "record_identification": "2",
        "sequence_number": "0001",
      },
    ]
  `)
})

it('should parse movement 2.3', () => {
  expect(
    parse(
      '2300010000BE54805480215856                  EURBVBA.BAKKER PIET                         MESSAGE                              0 1'
    ).movements
  ).toMatchInlineSnapshot(`
    [
      {
        "article_code": "3",
        "communication": "MESSAGE",
        "counterparty": {
          "account": {
            "currency": "EUR",
            "number": "BE54805480215856",
          },
          "name": "BVBA.BAKKER PIET",
        },
        "detail_sequence": "0000",
        "record_identification": "2",
        "sequence": "0001",
      },
    ]
  `)
})

it('should parse the trailer', () => {
  expect(
    parse(
      '9               000015000000016837520000000003967220                                                                           1'
    ).trailer
  ).toMatchInlineSnapshot(`
    {
      "credit_amount": 3967.22,
      "debit_amount": 16837.52,
      "number_of_records": 15,
      "record_identification": "9",
    }
  `)
})

it.each([
  readFile(path.resolve(__dirname, './samples/sample1.cod'), 'utf8'),
  readFile(path.resolve(__dirname, './samples/sample2.cod'), 'utf8'),
  readFile(path.resolve(__dirname, './samples/sample3.cod'), 'utf8'),
  // Corrupt file?
  // readFile(path.resolve(__dirname, './samples/sample4.cod'), 'utf8'),
  readFile(path.resolve(__dirname, './samples/sample5.cod'), 'utf8'),
  readFile(path.resolve(__dirname, './samples/sample6.cod'), 'utf8'),
  readFile(path.resolve(__dirname, './samples/sample7.cod'), 'utf8'),
  readFile(path.resolve(__dirname, './samples/sample8.cod'), 'utf8'),
])('should parse sample file %#', async (f) => {
  let contents = await f

  expect(parse(contents)).toMatchSnapshot()
})
