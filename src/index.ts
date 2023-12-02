// Specification:
// - NL: https://febelfin.be/media/pages/publicaties/2021/gecodeerde-berichtgeving-coda/70fab4d01f-1694763197/standard-coda-2.6-nl-1.pdf
// - EN: https://febelfin.be/media/pages/publicaties/2021/gecodeerde-berichtgeving-coda/ba165bdbb2-1694763197/standard-coda-2.6-en.pdf

import { match, __ } from './utils/match'
import { StringStream } from './utils/string-stream'

export function parse(coda: string) {
  let result = {
    header: {} as ReturnType<typeof parseHeader>,
    balance: {
      old: {} as ReturnType<typeof parseOldBalance>,
      new: {} as ReturnType<typeof parseNewBalance>,
    },
    movements: [] as (
      | ReturnType<typeof parseMovement21>
      | ReturnType<typeof parseMovement22>
      | ReturnType<typeof parseMovement23>
    )[],
    information: [] as (
      | ReturnType<typeof parseAdditionalInformation31>
      | ReturnType<typeof parseAdditionalInformation32>
      | ReturnType<typeof parseAdditionalInformation33>
    )[],
    free_communications: [] as ReturnType<typeof parseFreeCommunication>[],
    trailer: {} as ReturnType<typeof parseTrailer>,
  }

  let state = {
    accountStructureData: null as null | number,
  }
  let lines = coda.trim().split('\n')

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    switch (line[0]) {
      // 0 = header record;
      case '0':
        Object.assign(result, {
          header: parseHeader(new StringStream(line)),
        })
        break

      // 1 = old balance;
      case '1':
        state.accountStructureData = Number(line[1])
        Object.assign(result, {
          balance: Object.assign(result.balance, {
            old: parseOldBalance(line),
          }),
        })
        break

      // 2 = movement;
      //
      // Part 1 is always mentioned
      // Parts 2 and 3 will be mentioned if necessary.
      case '2':
        if (line.startsWith('21')) {
          result.movements.push(parseMovement21(line))
        } else if (line.startsWith('22')) {
          result.movements.push(parseMovement22(line))
        } else if (line.startsWith('23')) {
          result.movements.push(parseMovement23(line))
        }
        break

      // 3 = additional information
      case '3':
        if (line.startsWith('31')) {
          result.information.push(parseAdditionalInformation31(line))
        } else if (line.startsWith('32')) {
          result.information.push(parseAdditionalInformation32(line))
        } else if (line.startsWith('33')) {
          result.information.push(parseAdditionalInformation33(line))
        }
        break

      // 8 = new balance
      case '8':
        Object.assign(result, {
          balance: Object.assign(result.balance, {
            new: parseNewBalance(line, state.accountStructureData),
          }),
        })
        break

      // (4) = free communications
      case '4':
        result.free_communications.push(parseFreeCommunication(line))
        break

      // 9 = trailer record
      case '9':
        Object.assign(result, {
          trailer: parseTrailer(line),
        })
        break

      default:
        throw new Error('Unknown record type')
    }
  }

  // Merge movement records
  {
    let drop = []
    for (let i = 0; i < result.movements.length; i++) {
      let movement = result.movements[i]

      if (movement.article_code === '1') {
        while (movement.next_code === '1') {
          i += 1

          if (result.movements[i]) {
            drop.push(result.movements[i])

            Object.assign(movement, result.movements[i], {
              communication: movement.communication + result.movements[i].communication,
            })
          }

          // File might be corrupt, expected a next movement record but none was found
          else {
            break
          }
        }

        // All other movement records (if any) are merged with the current one, time to parse the
        // communication itself.
        // @ts-expect-error TypeScript doesn't like this
        movement.communication = parseCommunicationMovement(
          movement.communication,

          // @ts-expect-error TypeScript doesn't like this
          movement.communication_type
        )
      }

      if (typeof movement.communication === 'string') {
        movement.communication = movement.communication.trim().replace(/\s{2,}/g, ' ')
      }
    }

    // These movements were merged, remove them from the result
    for (let movement of drop.splice(0)) {
      result.movements.splice(result.movements.indexOf(movement), 1)
    }
  }

  // Merge information records
  {
    let drop = []
    for (let i = 0; i < result.information.length; i++) {
      let information = result.information[i]

      if (information.article_code === '1') {
        while (information.next_code === '1') {
          i += 1

          if (result.information[i]) {
            drop.push(result.information[i])

            Object.assign(information, result.information[i], {
              communication: information.communication + result.information[i].communication,
            })
          }

          // File might be corrupt, expected a next information record but none was found
          else {
            break
          }
        }

        // All other information records (if any) are merged with the current one, time to parse the
        // communication itself.
        // @ts-expect-error TypeScript doesn't like this
        information.communication = parseCommunicationDetail(
          information.communication,

          // @ts-expect-error TypeScript doesn't like this
          information.communication_type
        )
      }

      if (typeof information.communication === 'string') {
        information.communication = information.communication.trim().replace(/\s{2,}/g, ' ')
      }
    }

    // These information records were merged, remove them from the result
    for (let information of drop.splice(0)) {
      result.information.splice(result.information.indexOf(information), 1)
    }
  }

  // Merge free communication records
  {
    let drop = []
    for (let i = 0; i < result.free_communications.length; i++) {
      let communication = result.free_communications[i]

      while (communication.link_code === '1') {
        i += 1

        if (result.free_communications[i]) {
          drop.push(result.free_communications[i])

          Object.assign(communication, result.free_communications[i], {
            text: communication.text + result.free_communications[i].text,
          })
        }

        // File might be corrupt, expected a next free communication record but none was found
        else {
          break
        }
      }

      // All other free communication records (if any) are merged with the current one, time to
      // parse the communication itself.
      communication.text = communication.text.trim().replace(/\s{2,}/g, ' ')
    }

    // These movements were merged, remove them from the result
    for (let communication of drop.splice(0)) {
      result.free_communications.splice(result.free_communications.indexOf(communication), 1)
    }
  }

  // Cleanup unnecesary fields
  {
    for (let record of result.movements) {
      // Cleanup next codes
      // @ts-expect-error TypeScript doesn't like this
      delete record['next_code']

      // Cleanup link codes
      // @ts-expect-error TypeScript doesn't like this
      delete record['link_code']
    }

    for (let record of result.information) {
      // Cleanup next codes
      // @ts-expect-error TypeScript doesn't like this
      delete record['next_code']

      // Cleanup link codes
      // @ts-expect-error TypeScript doesn't like this
      delete record['link_code']
    }

    for (let record of result.free_communications) {
      // Cleanup link codes
      // @ts-expect-error TypeScript doesn't like this
      delete record['link_code']
    }
  }

  // Move information records to the correct movement record
  {
    let drop = []
    for (let i = 0; i < result.information.length; i++) {
      let information = result.information[i]

      for (let movement of result.movements) {
        if (
          // @ts-expect-error TypeScript doesn't like this
          movement.sequence === information.sequence &&
          // @ts-expect-error TypeScript doesn't like this
          movement.reference_number === information.reference_number
        ) {
          // @ts-expect-error TypeScript doesn't like this
          movement.information = movement.information ?? []
          // @ts-expect-error TypeScript doesn't like this
          movement.information.push(information)
          drop.push(information)
        }
      }
    }

    // These information records were merged, remove them from the result
    for (let record of drop.splice(0)) {
      result.information.splice(result.information.indexOf(record), 1)
    }
  }

  return result
}

// Header record 0
function parseHeader(stream: StringStream) {
  return {
    // Record identification = 0
    record_identification: stream.take(1),

    // Creation date (DDMMYY) - Repairing or duplicating does not alter the original creation date.
    date: parseDate(stream.skip(4).take(6)),

    // Bank identification number or zeros
    bank_identification_number: stream.take(3),

    // Application code = 05
    application_code: stream.take(2),

    // If duplicate "D", otherwise blank
    duplicate: stream.take(1) === Duplicate,

    // File reference as determined by the bank or blank
    file_reference: stream.skip(7).take(10),

    account: {
      // Name addressee
      name: stream.take(26).trim(),

      // BIC of the bank holding the account (8 characters followed by 3 blanks or 11 characters)
      bic: stream.take(11).trim(),

      // Identification number of the Belgium-based account holder: 0 + company number
      identification_number: stream.take(11),
    },

    // Code "separate application"
    external_application_code: stream.skip(1).take(5),

    // Blank or Transaction reference
    transaction_reference: stream.take(16).trim(),

    // Blank or Related reference
    related_reference: stream.take(16).trim(),

    // Version code = 2
    version: Number(stream.skip(7).take(1)),
  }
}

// Data record - "old balance" 1
function parseOldBalance(line: string) {
  return {
    // Record identification = 1
    record_identification: line[0],

    account: {
      // Name of the account holder
      name: line.slice(64, 90).trim(),

      // Account description
      description: line.slice(90, 125).trim(),

      ...parseAccount(
        // Account structure
        //
        // 0 = Belgian account number
        // 1 = foreign account number
        // 2 = IBAN of the Belgian account number
        // 3 = IBAN of the foreign account number
        Number(line[1]),

        // Account number and currency code (see 7.5)
        line.slice(5, 42)
      ),
    },

    // Sequence number statement of account on paper or Julian date or zeros.
    //
    // This number may be different from the number specified in the ‘new balance’ record (contact
    // your bank for concrete specifications).
    //
    // In case of a non-Belgian account number: last 3 positions of the first part of the statement
    // of account number
    sequence_number: line.slice(2, 5),

    // Old balance sign:
    //
    // 0 = credit
    // 1 = debit

    // Old balance
    //
    // (12 pos. + 3 decimals)
    balance:
      Number(line.slice(43, 58)) *
      match(line[42], {
        [Sign.Credit]: 1,
        [Sign.Debit]: -1,
      }),

    // Old balance date (DDMMYY)
    //
    // In an empty file, this will be the ‘new balance’ date of the latest file including movement.
    // This date will be changed only after the next file including movement.
    //
    // As for separate applications, this field contains the creation date of the previous file.
    date: parseDate(line.slice(58, 64)),

    // Sequence number of the coded statement of account or zeros.
    //
    // Each year, this number starts at 001 and will be increased by 1 each time a file with or
    // without movement is created.
    //
    // As for a non-Belgian account number: last 3 positions of the first part of the statement of
    // account number
    coda_sequence_number: line.slice(125, 128),
  }
}

function parseAccount(structure: number, line: string) {
  let stream = new StringStream(line)

  switch (structure) {
    // 0 = Belgian account number
    case 0:
      // 12 N Belgian account number
      // 1 AN blank
      // 3 AN ISO currency code or blank
      // 1 N qualification code or blank
      // 2 AN ISO country code or blank
      // 3 AN blank spaces
      // 15 AN extension zone or blank
      return {
        type: structure,
        type_description: 'Belgian account number',
        number: stream.take(12).trim(),
        currency: stream.skip(1).take(3).trim(),
        qualification_code: stream.take(1).trim(),
        country: stream.take(2).trim(),
        extension_zone: stream.skip(3).take(15).trim(),
      }

    // 1 = Foreign account number
    case 1:
      // 34 AN foreign account number
      // 3 AN ISO currency code of the account (optional for counterparty)
      return {
        type: structure,
        type_description: 'Foreign account number',
        number: stream.take(34).trim(),
        currency: stream.take(3).trim(),
      }

    // 2 = IBAN of the Belgian account number
    case 2:
      // 31 AN IBAN (Belgian number)
      // 3 AN extension zone or blank
      // 3 AN ISO currency code of the account (optional for counterparty)
      return {
        type: structure,
        type_description: 'IBAN of the Belgian account number',
        number: stream.take(31).trim(),
        currency: stream.skip(3).take(3).trim(),
      }

    // 3 = IBAN of the foreign account number
    case 3:
      // 34 AN IBAN (foreign account number)
      // 3 AN ISO currency code of the account (optional for counterparty)
      return {
        type: structure,
        type_description: 'IBAN of the foreign account number',
        number: stream.take(34).trim(),
        currency: stream.take(3).trim(),
      }
  }
}

// 2.1 Movement record
function parseMovement21(line: string) {
  return {
    // Record identification = 2
    record_identification: line[0],

    // Article code = 1
    article_code: line[1],

    // Continuous sequence number
    //
    // Starts at 0001 and is increased by 1 for each movement record referring to another movement
    // on the daily statement of account. If there are more than 9,999 transactions, the number goes
    // up to 0000 and then 0001.
    sequence: line.slice(2, 6),

    // Detail number starts at 0000 and is increased by 1 for each movement record for the same
    // continuous sequence number. If there are more than 9,999 details relating to one single
    // transaction, the number goes up to 0000 and then 0001.
    detail_sequence: line.slice(6, 10),

    // Reference number of the bank
    //
    // This information is purely informative.
    reference_number: line.slice(10, 31).trim(),

    // Movement sign:
    //
    // 0 = credit
    // 1 = debit

    // Amount: 12 pos. + 3 decimals
    amount:
      (Number(line.slice(32, 47)) * (line[31] === Sign.Credit ? 1 : -1),
      Number(line.slice(32, 47)) * (line[31] === Sign.Credit ? 1 : -1)) / 1_000,

    // Value date or 000000 if not known (DDMMYY)
    value_date: line.slice(47, 53) === UnknownDate ? null : parseDate(line.slice(47, 53)),

    // Transaction code (see enclosure II)
    transaction_code: parseTransactionCode(line.slice(53, 61)),

    // Communication type:
    //
    // 0 = none or unstructured
    // 1 = structured
    communication_type: match(line[61], {
      '0': 'unstructured',
      '1': 'structured',
    }),

    // Communication zone:
    //
    // - if pos. 62 = 0 free communication in pos. 63 up to 115
    // - if pos. 62 = 1 type of structured communication in pos. 63 up to 65, and communication as
    //   of pos. 66 (see enclosure III)
    communication: line.slice(62, 115),

    // Entry date DDMMYY
    entry_date: parseDate(line.slice(115, 121)),

    // Sequence number statement of account on paper or Julian date or zeros.
    //
    // As for a non-Belgian account number: last 3 positions of the first part of the statement of
    // account number.
    sequence_number: line.slice(121, 124),

    // Globalisation code
    //
    // Marks the beginning and end of a globalisation for each hierarchy level.
    globalisation_code: line[124],

    // Next code:
    //
    // 0 = no record 2 or 3 with record identification 2 is following
    // 1 = a record 2 or 3 with record identification 2 is following
    next_code: line[125],

    // Link code with next data record:
    //
    // 0 = no information record is following (data record 3)
    // 1 = an information record is following
    link_code: line[127],
  }
}

// Data record 2.2 - "movement record"
function parseMovement22(line: string) {
  return {
    // Record identification = 2
    record_identification: line[0],

    // Article code = 2
    article_code: line[1],

    // Continuous sequence number
    sequence_number: line.slice(2, 6),

    // Detail number
    detail_sequence: line.slice(6, 10),

    // Communication (ctd.)
    communication: line.slice(10, 63),

    // Customer reference or blank: see 7.8
    customer_reference: line.slice(63, 98).trim(),

    // BIC (8 or 11 characters) of the counterparty's bank or blank
    bic: line.slice(98, 109).trim(),

    // Type of R-transaction or blank
    // 1 : Reject
    // 2 : Return
    // 3 : Refund
    // 4 : Reversal
    // 5 : Cancellation
    r_transaction_type: line[112].trim(),

    // ISO Reason Return Code or blanks
    //
    // For a list of possible codes, see
    // http://www.iso20022.org/external_code_list.page
    //
    // EPC Guidance on reason codes for SDD R-transactions
    r_reason: line.slice(113, 117).trim(),

    // "CategoryPurpose": see 7.6
    category_purpose: line.slice(117, 121).trim(),

    // "Purpose": see 7.6
    purpose: line.slice(121, 125).trim(),

    // Next code:
    //
    // 0 = no record 3 with record identification 2 is following
    // 1 = a record 3 with record identification 2 is following
    next_code: line[125],

    // Link code with next data record:
    //
    // 0 = no information record is following (data record 3)
    // 1 = an information record is following
    link_code: line[127],
  }
}

// Data record 2.3 - "movement record"
function parseMovement23(line: string) {
  let [accountNumber = '', accountCurrency = ''] = line.slice(10, 47).trim().split(/\s+/g) ?? []
  return {
    // Record identification = 2
    record_identification: line[0],

    // Article code = 3
    article_code: line[1],

    // Continuous sequence number
    sequence: line.slice(2, 6),

    // Detail number
    detail_sequence: line.slice(6, 10),

    counterparty: {
      // Counterparty's account number and currency code or blank
      account: {
        number: accountNumber,
        currency: accountCurrency,
      },

      // Counterparty's name
      name: line.slice(47, 82).trim(),
    },

    // Communication (ctd.)
    communication: line.slice(82, 115),

    // Next code: always 0
    next_code: line[125],

    // Link code with next data record:
    //
    // 0 = no information code is following (data record 3)
    // 1 = an information record is following
    link_code: line[127],
  }
}

// Data record 3.1 - "information record"
function parseAdditionalInformation31(line: string) {
  return {
    // Record identification = 3
    record_identification: line[0],

    // Article code = 1
    article_code: line[1],

    // Continuous sequence number: must be identical to the continuous sequence number of the
    // movement record to which the information record refers.
    sequence: line.slice(2, 6),

    // Detail number
    detail_sequence: line.slice(6, 10),

    // Reference number added by the bank: must be identical to the reference number of the movement
    // record to which the information record refers.
    reference_number: line.slice(10, 31).trim(),

    // Transaction code
    transaction_code: parseTransactionCode(line.slice(31, 39)),

    // Code structure communication zone:
    //
    // 0 = none or unstructured
    // 1 = structured
    communication_type: match(line[39], {
      '0': 'unstructured',
      '1': 'structured',
    }),

    // Communication:
    //
    // - if pos. 40 = 0 free communication in pos. 41 to 113
    // - if pos. 40 = 1 type of structured communication in pos. 41 to 43 and actual communication
    //   as of pos. 44 (see enclosure III)
    communication: line.slice(40, 113),

    // Next code:
    //
    // 0 = no record 2 with record identification 3 is following
    // 1 = a record 2 with record identification 3 is following
    next_code: line[125],

    // Link code with next data record:
    //
    // 0 = no information record is following (data record 3)
    // 1 = an information record is following
    link_code: line[127],
  }
}

// Data record 3.2 - "information record"
function parseAdditionalInformation32(line: string) {
  return {
    // Record identification = 3
    record_identification: line[0],

    // Article code = 2
    article_code: line[1],

    // Continuous sequence number
    sequence: line.slice(2, 6),

    // Detail number
    detail_sequence: line.slice(6, 10),

    // Communication (ctd.)
    communication: line.slice(10, 115),

    // Next code:
    //
    // 0 = no record 3 with record identification 3 is following
    // 1 = a record 3 with record identification 3 is following
    next_code: line[125],

    // Link code with next data record:
    //
    // 0 = no information record is following (data record 3)
    // 1 = an information record is following
    link_code: line[127],
  }
}

// Data record 3.3 - "information record"
function parseAdditionalInformation33(line: string) {
  return {
    // Record identification = 3
    record_identification: line[0],

    // Article code = 3
    article_code: line[1],

    // Continuous sequence number
    sequence: line.slice(2, 6),

    // Detail number
    detail_sequence: line.slice(6, 10),

    // Communication (ctd.)
    communication: line.slice(10, 100),

    // Next code: always 0
    next_code: line[125],

    // Link code with next data record:
    //
    // 0 = no information record is following (data record 3)
    // 1 = an information record is following
    link_code: line[127],
  }
}

// Data record 8 - "new balance"
function parseNewBalance(line: string, accountStructureData: number | null) {
  return {
    // Record identification = 8
    record_identification: line[0],

    // Sequence number statement of account on paper or Julian date or zeros: This number may be
    // different from the number specified in the ‘old balance’ record.
    //
    // 000 in case of a separate application.
    //
    // As for a non-Belgian account number: last 3 positions of the first part of the statement of
    // account number.
    sequence_number: line.slice(1, 4),

    // Account number and currency code (see 7.5)
    account:
      accountStructureData === null
        ? {}
        : {
            ...parseAccount(
              // Account structure: Position 2 of the type 1 data record (old balance)
              //
              // 0 = Belgian account number
              // 1 = foreign account number
              // 2 = IBAN of the Belgian account number
              // 3 = IBAN of the foreign account number
              accountStructureData,

              // Account number and currency code (see 7.5)
              line.slice(4, 41)
            ),
          },

    // New balance sign:
    //
    // 0 = credit
    // 1 = debit

    // New balance
    //
    // (12 pos. + 3 decimals)
    balance:
      (Number(line.slice(42, 57)) *
        match(line[41], {
          [Sign.Credit]: 1,
          [Sign.Debit]: -1,
        })) /
      1_000,

    // New balance date (DDMMYY)
    date: parseDate(line.slice(57, 63)),

    // Link code with next data record:
    //
    // 0 = no free communication is following (data record 4)
    // 1 = a free communication is following
    link_code: line[127],
  }
}

// Data record 4 - "free communication"
function parseFreeCommunication(line: string) {
  return {
    // Record identification = 4
    record_identification: line[0],

    // Continuous sequence number: starts at 0001 and is increased by 1 for each record referring to
    // another 'free communication'
    sequence: line.slice(2, 6),

    // Detail number: starts at 0000 and is increased by 1 for each record of the same 'free
    // communication'
    detail_sequence: line.slice(6, 10),

    // Text of the free communication
    text: line.slice(32, 112).trim(),

    // Link code with the next data record:
    //
    // 0 = no free communication is following
    // 1 = a free communication is following
    link_code: line[127],
  }
}

// Trailer record 9
function parseTrailer(line: string) {
  return {
    // Record identification = 9
    record_identification: line[0],

    // Number of records 1, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3 and 8
    number_of_records: Number(line.slice(16, 22)),

    // Debit movement
    //
    // Sum of the amounts in type 2 records with detail number 0000
    // 12 pos. + 3 decimals
    debit_amount: Number(line.slice(22, 37)) / 1_000,

    // Credit movement:
    //
    // Sum of the amounts in type 2 records with detail number 0000
    // 12 pos. + 3 decimals
    credit_amount: Number(line.slice(37, 52)) / 1_000,

    // Multiple file code:
    //
    // 1 = another file is following
    // 2 = last file
    // multiple_file_code: line[127],
  }
}

function parseTransactionCode(input: string) {
  let stream = new StringStream(input)

  return {
    // Type
    type: stream.take(1),

    // 01 to 39: Domestic or local SEPA transactions
    // 41 to 79: Foreign/non-SEPA transactions
    // 80 to 89: Other families
    //
    // 01 Domestic or local SEPA credit transfers
    //   41 International credit transfers - non-SEPA credit transfers
    // 02 Instant SEPA credit transfer
    // 03 Cheques
    //   43 Foreign cheques
    // 04 Cards
    // 05 Direct debit
    // 07 Domestic commercial paper
    //   47 Foreign commercial paper
    // 09 Counter transactions
    // 11 Securities
    // 13 Credit
    // 30 Various transactions
    // 35 Closing (periodical settlements for interest, costs, ...)
    // 80 Separately charged costs and provisions
    family: stream.take(2),
    get family_description() {
      return match(this.family, {
        '01': 'Domestic or local SEPA credit transfers',
        '41': 'International credit transfers - non-SEPA credit transfers',
        '02': 'Instant SEPA credit transfer',
        '03': 'Cheques',
        '43': 'Foreign cheques',
        '04': 'Cards',
        '05': 'Direct debit',
        '07': 'Domestic commercial paper',
        '47': 'Foreign commercial paper',
        '09': 'Counter transactions',
        '11': 'Securities',
        '13': 'Credit',
        '30': 'Various transactions',
        '35': 'Closing (periodical settlements for interest, costs, ...)',
        '80': 'Separately charged costs and provisions',

        [__]: '<Unknown>',
      })
    },

    // Transaction
    transaction: stream.take(2),
    get transaction_description() {
      return match(this.family, {
        // Domestic or local SEPA credit transfers
        '01': () => {
          return match(this.transaction, {
            // Debit transactions
            '01': 'Individual transfer order',
            '02': 'Individual transfer order initiated by the bank',
            '03': 'Standing order',
            '05': 'Payment of wages, etc.',
            '07': 'Collective transfer',
            '13': 'Transfer from your account',
            '17': 'Financial centralisation',
            '37': 'Costs',
            '39': 'Your issue circular cheque',
            // 40 to 48: Codes proper to each bank
            '49': 'Cancellation or correction',

            // Credit transactions
            '50': 'Transfer in your favour',
            '51': 'Transfer in your favour – initiated by the bank',
            '52': 'Payment in your favour',
            '54': 'Unexecutable transfer order',
            '60': 'Non-presented circular cheque',
            '62': 'Unpaid postal order',
            '64': 'Transfer to your account',
            '66': 'Financial centralization',
            '87': 'Reimbursement of costs',
            // 90 to 98: Codes proper to each bank
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        // Instant SEPA credit transfer
        '02': () => {
          return match(this.transaction, {
            // Debit transactions
            '01': 'Individual transfer order',
            '02': 'Individual transfer order initiated by the bank',
            '03': 'Standing order',
            '05': 'Payment of wages, etc.',
            '07': 'Collective transfer',
            '13': 'Transfer from your account',
            '17': 'Financial centralisation',
            '37': 'Costs',
            // 40 to 48: Codes proper to each bank
            '49': 'Cancellation or correction',

            // Credit transactions
            '50': 'Transfer in your favour',
            '51': 'Transfer in your favour – initiated by the bank',
            '52': 'Payment in your favour',
            '54': 'Unexecutable transfer order',
            '64': 'Transfer to your account',
            '66': 'Financial centralization',
            '87': 'Reimbursement of costs',
            // 90 to 98: Codes proper to each bank
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        // Cheques
        '03': () => {
          return match(this.transaction, {
            // Debit transactions
            '01': 'Payment of your cheque',
            '05': 'Payment of voucher',
            '09': 'Unpaid voucher',
            '11': 'Department store cheque',
            '15': 'Your purchase bank cheque',
            '17': 'Your certified cheque',
            '37': 'Cheque-related costs',
            '38': 'Provisionally unpaid',
            // 40 to 48: Codes proper to each bank
            '49': 'Cancellation or correction',

            // Credit transactions
            '52': 'First credit of cheques, vouchers, luncheon vouchers, postal orders, credit under usual reserve',
            '58': 'Remittance of cheques, vouchers, etc. credit after collection',
            '60': 'Reversal of voucher',
            '62': 'Reversal of cheque',
            '63': 'Second credit of unpaid cheque',
            '66': 'Remittance of cheque by your branch - credit under usual reserve',
            '87': 'Reimbursement of cheque-related costs',
            // 90 to 98: Codes proper to each bank
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        // Cards
        '04': () => {
          return match(this.transaction, {
            // Debit transactions
            '01': 'Loading a GSM card',
            '02': 'Payment by means of a payment card within the Eurozone',
            '03': 'Settlement credit cards',
            '04': 'Cash withdrawal from an ATM',
            '05': 'Loading Proton',
            '06': 'Payment with tank card',
            '07': 'Payment by GSM',
            '08': 'Payment by means of a payment card outside the Eurozone',
            '09': 'Upload of prepaid card',
            '10': 'Correction for prepaid card',
            '37': 'Costs',
            // 40 to 48: Codes proper to each bank
            '49': 'Cancellation or correction',

            // Credit transactions
            '50': 'Credit after a payment at a terminal',
            '51': 'Unloading Proton',
            '52': 'Loading GSM cards',
            '53': 'Cash deposit at an ATM',
            '54': 'Download of prepaid card',
            '55': 'Income from payments by GSM',
            '56': 'Correction for prepaid card',
            '68': 'Credit after Proton payments',
            '87': 'Reimbursement of costs',
            // 90 to 98: Codes proper to each bank
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        // Direct debit
        '05': () => {
          return match(this.transaction, {
            // Debit transactions
            '01': 'Payment',
            '03': 'Unpaid debt',
            '05': 'Reimbursement',
            '37': 'Costs',
            // 40 to 48: Codes proper to each bank
            '49': 'Cancellation or correction',

            // Credit transactions
            '50': 'Credit after collection',
            '52': 'Credit under usual reserve',
            '54': 'Reimbursement',
            '56': 'Unexecutable reimbursement',
            '58': 'Reversal',
            '87': 'Reimbursement of costs',
            // 90 to 98: Codes proper to each bank
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        // Domestic commercial paper
        '07': () => {
          return match(this.transaction, {
            // Debit transactions
            '01': 'Payment commercial paper',
            '05': 'Commercial paper claimed back',
            '06': 'Extension of maturity date',
            '07': 'Unpaid commercial paper',
            '08': 'Payment in advance',
            '09': "Agio on supplier's bill",
            '37': 'Costs related to commercial paper',
            '39': 'Return of an irregular bill of exchange',
            // 40 to 48: Codes proper to each bank
            '49': 'Cancellation or correction',

            // Credit transactions
            '50': 'Remittance of commercial paper - credit after collection',
            '52': 'Remittance of commercial paper - credit under usual reserve',
            '54': 'Remittance of commercial paper - for discount',
            '56': "Remittance of supplier's bill with guarantee",
            '58': "Remittance of supplier's bill without guarantee",
            '87': 'Reimbursement of costs',
            // 90 to 98: Codes proper to each bank
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        // Counter transactions
        '09': () => {
          return match(this.transaction, {
            // Debit transactions
            '01': 'Cash withdrawal',
            '05': 'Purchase of foreign bank notes',
            '07': 'Purchase of gold/pieces',
            '09': 'Purchase of petrol coupons',
            '13': 'Cash withdrawal by your branch or agents',
            '17': 'Purchase of fiscal stamps',
            '19': 'Difference in payment',
            '25': "Purchase of traveller's cheque",
            '37': 'Costs',
            // 40 to 48: Codes proper to each bank
            '49': 'Cancellation or correction',

            // Credit transactions
            '50': 'Cash payment',
            '52': 'Payment night safe',
            '58': 'Payment by your branch/agents',
            '60': 'Sale of foreign bank notes',
            '62': 'Sale of gold/pieces under usual reserve',
            '68': 'Difference in payment',
            '70': "Sale of traveller's cheque",
            '87': 'Reimbursement of costs',
            // 90 to 98: Codes proper to each bank
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        // Securities
        '11': () => {
          return match(this.transaction, {
            // Debit transactions
            '01': 'Purchase of securities',
            '02': 'Tenders',
            '03': 'Subscription to securities',
            '04': 'Issues',
            '05': 'Partial payment subscription',
            '06': 'Share option plan – exercising an option',
            '09': 'Settlement of securities',
            '11': 'Payable coupons/repayable securities',
            '13': 'Your repurchase of issue',
            '15': 'Interim interest on subscription',
            '17': 'Management fee',
            '19': 'Regularisation costs',
            '37': 'Costs',
            // 40 to 48: Codes proper to each bank
            '49': 'Cancellation or correction',

            // Credit transactions
            '50': 'Sale of securities',
            '51': 'Tender',
            '52': 'Payment of coupons from a deposit or settlement of coupons delivered over the counter - credit under usual reserve',
            '58': 'Repayable securities from a deposit or delivered at the counter - credit under usual reserve',
            '62': 'Interim interest on subscription',
            '64': 'Your issue',
            '66': 'Retrocession of issue commission',
            '68': 'Compensation for missing coupon',
            '70': 'Settlement of securities',
            '87': 'Reimbursement of costs',
            // 90 to 98: Codes proper to each bank
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        // Credits
        '13': () => {
          return match(this.transaction, {
            // Debit transactions
            '01': 'Short-term loan',
            '02': 'Long-term loan',
            '05': 'Settlement of fixed advance',
            '07': 'Your repayment instalment',
            '11': 'Your repayment mortgage loan',
            '13': 'Settlement of bank acceptances',
            '15': 'Your repayment hire-purchase and similar claims',
            '19': 'Documentary import credits',
            '21': 'Other credit applications',
            '37': 'Credit-related costs',
            // 40 to 48: Codes proper to each bank
            '49': 'Cancellation or correction',

            // Credit transactions

            '50': 'Settlement of instalment credit',
            '54': 'Fixed advance – capital and interest',
            '55': 'Fixed advance – interest only',
            '56': 'Subsidy',
            '60': 'Settlement of mortgage loan',
            '62': 'Term loan',
            '68': 'Documentary export credits',
            '70': 'Settlement of discount bank acceptance',
            '87': 'Reimbursement of costs',
            // 90 to 98: Codes proper to each bank
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        // Miscellaneous transactions
        '30': () => {
          return match(this.transaction, {
            // Debit transactions
            '01': 'Spot purchase of foreign exchange',
            '03': 'Forward purchase of foreign exchange',
            '05': 'Capital and/or interest term investment',
            '33': 'Value (date) correction',
            '37': 'Costs',
            '39': 'Undefined transaction',
            // 40 to 48: Codes proper to each bank
            '49': 'Cancellation or correction',

            // Credit transactions
            '50': 'Spot sale of foreign exchange',
            '52': 'Forward sale of foreign exchange',
            '54': 'Capital and/or interest term investment',
            '55': 'Interest term investment',
            '83': 'Value (date) correction',
            '87': 'Reimbursement of costs',
            '89': 'Undefined transaction',
            // 90 to 98: Codes proper to each bank
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        // Closing (e.g.: periodical settlements for interest, costs, ...)
        '35': () => {
          return match(this.transaction, {
            // Debit transactions
            '01': 'Closing',
            '37': 'Costs',
            // 40 to 48: Codes proper to each bank
            '49': 'Cancellation or correction',

            // Credit transactions
            '50': 'Closing',
            '87': 'Reimbursement of costs',
            // 90 to 98: Codes proper to each bank
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        // Foreign/non-SEPA credit transfers
        '41': () => {
          return match(this.transaction, {
            // Debit transactions
            '01': 'Transfer',
            '03': 'Standing order',
            '05': 'Collective payments of wages',
            '07': 'Collective transfers',
            '13': 'Transfer from your account',
            '17': 'Financial centralisation (debit)',
            '37': 'Costs relating to outgoing foreign transfers and non-SEPA transfers',
            '38': 'Costs relating to incoming foreign and non-SEPA transfers',
            // 40 to 48: Codes proper to each bank
            '49': 'Cancellation or correction',

            // Credit transactions
            '50': 'Transfer',
            '64': 'Transfer to your account',
            '66': 'Financial centralisation (credit)',
            '87': 'Reimbursement of costs',
            // 90 to 98: Codes proper to each bank
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        // Foreign cheques
        '43': () => {
          return match(this.transaction, {
            // Debit transactions
            '01': 'Payment of a foreign cheque',
            '07': 'Unpaid foreign cheque',
            '15': 'Purchase of an international bank cheque',
            '37': 'Costs relating to payment of foreign cheques',
            // 40 to 48: Codes proper to each bank
            '49': 'Cancellation or correction',

            // Credit transactions
            '52': 'Remittance of foreign cheque credit under usual reserve',
            '58': 'Remittance of foreign cheque credit after collection',
            '62': 'Reversal of cheques',
            '87': 'Reimbursement of costs',
            // 90 to 98: Codes proper to each bank
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        // Foreign commercial paper
        '47': () => {
          return match(this.transaction, {
            // Debit transactions
            '01': 'Payment of foreign bill',
            '05': 'Bill claimed back',
            '06': 'Extension',
            '07': 'Unpaid foreign bill',
            '11': 'Payment documents abroad',
            '13': "Discount foreign supplier's bills",
            '14': 'Warrant fallen due',
            '37': 'Costs relating to the payment of a foreign bill',
            // 40 to 48: Codes proper to each bank
            '49': 'Cancellation or correction',

            // Credit transactions
            '50': 'Remittance of foreign bill credit after collection',
            '52': 'Remittance of foreign bill credit under usual reserve',
            '54': 'Discount abroad',
            '56': "Remittance of guaranteed foreign supplier's bill",
            '58': "Remittance of foreign supplier's bill without guarantee",
            '60': 'Remittance of documents abroad - credit under usual reserve',
            '62': 'Remittance of documents abroad - credit after collection',
            '64': 'Warrant',
            '87': 'Reimbursement of costs',
            // 90 to 98: Codes proper to each bank
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        // Fees and commissions charged separately
        '80': () => {
          return match(this.transaction, {
            // Debit transactions
            '02': 'Costs relating to electronic output',
            '04': 'Costs for holding a documentary cash credit',
            '06': 'Damage relating to bills and cheques',
            '07': 'Insurance costs',
            '08': 'Registering compensation for savings accounts',
            '09': 'Postage',
            '10': 'Purchase of Smartcard',
            '11': 'Costs for the safe custody of correspondence',
            '12': 'Costs for opening a bank guarantee',
            '13': 'Renting of safes',
            '14': 'Handling costs instalment credit',
            '15': 'Night safe',
            '16': 'Bank confirmation to revisor or accountant',
            '17': 'Charge for safe custody',
            '18': 'Trade information',
            '19': 'Special charge for safe custody',
            '20': 'Drawing up a certificate',
            '21': 'Pay-packet charges',
            '22': 'Management/custody',
            '23': 'Research costs',
            '24': 'Participation in and management of interest refund system',
            '25': 'Renting of direct debit box',
            '26': 'Travel insurance premium',
            '27': 'Subscription fee',
            '29': 'Information charges',
            '31': 'Writ service fee',
            '33': 'Miscellaneous fees and commissions',
            '35': 'Costs',
            '37': 'Access right to database',
            '39': 'Surety fee',
            '41': 'Research costs',
            '43': 'Printing of forms',
            '45': 'Documentary credit charges',
            '47': 'Charging fees for transactions',
            '49': 'Cancellation or correction',

            // Credit transactions
            '99': 'Cancellation or correction',

            [__]: '<Unknown>',
          })
        },

        [__]: '<Unknown>',
      })
    },

    // Category
    category: stream.take(3),
    get category_description() {
      return match(this.category, {
        '000': 'Net amount',
        '001': 'Interest received',
        '002': 'Interest paid',
        '003': 'Credit commision',
        '004': 'Postage',
        '005': 'Renting of letterbox',
        '006': 'Various fees/commissions',
        '007': 'Access right to database',
        '008': 'Information charges',
        '009': 'Travelling expenses',
        '010': 'Writ service fee',
        '011': 'VAT',
        '012': 'Exchange commission',
        '013': 'Payment commission',
        '014': 'Collection commission',
        '015': 'Correspondent charges',
        '016': 'Negative interest',
        '017': 'Research costs',
        '018': 'Tental guarantee charges',
        '019': 'Tax on physical delivery',
        '020': 'Costs of physical delivery',
        '021': 'Costs for drawing up a bank cheque',
        '022': 'Priority costs',
        '023': 'Exercising fee',
        '024': 'Growth premium',
        '025': 'Individual entry for exchange charges',
        '026': 'Handling commission',
        '027': 'Charges for unpaid bills',
        '028': 'Fidelity premium',
        '029': 'Protest charges',
        '030': 'Account insurance',
        '031': 'Charges foreign cheque',
        '032': 'Drawing up a circular cheque',
        '033': 'Charges for a foreign bill',
        '034': 'Reinvestment fee',
        '035': 'Charges foreign documentary bill',
        '036': 'Costs relating to a refused cheque',
        '037': 'Commission for handling charges',
        '039': 'Telecommunications',
        '041': 'Credit card costs',
        '042': 'Payment card costs',
        '043': 'Insurance costs',
        '045': 'Handling costs',
        '047': 'Charges extension bill',
        '049': 'Fiscal stamps/stamp duty',
        '050': 'Capital term investment',
        '051': 'Withholding tax',
        '052': '',
        '053': 'Printing of forms',
        '055': 'Repayment loan or credit capital',
        '057': 'Interest subsidy',
        '058': 'Capital premium',
        '059': 'Default interest',
        '061': 'Charging fees for transactions',
        '063': 'Rounding differences',
        '065': 'Interest payment advice',
        '066': 'Fixed loan advance – reimbursement',
        '067': 'Fixed loan advance - extension',
        '068': 'Countervalue of an entry',
        '069': 'Forward arbitrage contracts: sum to be supplied by customer',
        '070': 'Forward arbitrage contracts: sum to be supplied by bank',
        '071': 'Fixed loan advance - availability',
        '072': 'Countervalue of commission to third party',
        '073': 'Costs of ATM abroad',
        '074': 'Mailing costs',
        '100': 'Gross amount',
        '200': 'Overall documentary credit charges',
        '201': 'Advice notice commission',
        '202': ['Advising commission', 'Additional advising commission'],
        '203': [
          'Confirmation fee',
          'Additional confirmation fee',
          'Commitment fee',
          'Flat fee',
          'Confirmation reservation commission',
          'Additional reservation commission',
        ].join('\n'),
        '204': 'Amendment fee',
        '205': [
          'Documentary payment commission',
          'Document commission',
          'Drawdown fee',
          'Negotiation fee',
        ].join('\n'),
        '206': 'Surety fee/payment under reserve',
        '207': 'Non-conformity fee',
        '208': 'Commitment fee deferred payment',
        '209': 'Transfer commission',
        '210': 'Commitment fee',
        '211': ['Credit arrangement fee', 'Additional credit arrangement fee'],
        '212': 'Warehousing fee',
        '213': 'Financing fee',
        '214': 'Issue commission (delivery order)',
        '400': 'Acceptance fee',
        '401': 'Visa charges',
        '402': 'Certification costs',
        '403': 'Minimum discount rate',
        '404': 'Discount commission',
        '405': 'Bill guarantee commission',
        '406': 'Collection charges',
        '407': 'Costs Article 45',
        '408': 'Cover commission',
        '409': 'Safe deposit charges',
        '410': 'Reclamation charges',
        '411': 'Fixed collection charge',
        '412': 'Advice of expiry charges',
        '413': 'Acceptance charges',
        '414': 'Regularisation charges',
        '415': 'Surety fee',
        '416': 'Charges for the deposit of security',
        '418': 'Endorsement commission',
        '419': 'Bank service fee',
        '420': 'Retention charges',
        '425': "Foreign broker's commission",
        '426': "Belgian broker's commission",
        '427': 'Belgian Stock Exchange tax',
        '428': 'Interest accrued',
        '429': 'Foreign Stock Exchange tax',
        '430': 'Recovery of foreign tax',
        '431': 'Delivery of a copy',
        '435': 'Tax on physical securities',
        '436': 'Supplementary tax',
        '437': 'Speculation tax',
        '438': 'Securities account tax',

        // Categories 700 to 999 proper to each bank

        [__]: '<Unknown>',
      })
    },
  }
}

// Communication:
//
// - if pos. 40 = 0 free communication in pos. 41 to 113
// - if pos. 40 = 1 type of structured communication in pos. 41 to 43 and actual communication
//   as of pos. 44 (see enclosure III)
function parseCommunicationDetail(line: string, type: 'structured' | 'unstructured') {
  let stream = new StringStream(line)

  switch (type) {
    // None or unstructured
    case 'unstructured':
      return line
    // return stream.take(73)

    // Structured
    case 'structured': {
      switch (stream.take(3)) {
        // Data concerning the counterparty
        case '001':
          return {
            // Name
            name: stream.take(70).trim(),

            // Street, number, bus
            address: stream
              .take(35)
              .trim()
              .replace(/\s{2,}/g, ' '),

            // Locality
            locality: stream
              .take(35)
              .trim()
              .replace(/\s{2,}/g, ' '),

            // Identification code
            identification_code: stream.take(35).trim(),
          }

        // Communication from the bank
        case '002':
        // Counterparty’s banker
        case '004':
        // Data concerning the correspondent
        case '005':
          return {
            value: [
              stream.take(35).trim(),
              stream.take(35).trim(),
              stream.take(35).trim(),
              stream.take(35).trim(),
            ].join('\n'),
          }

        // Information concerning the detail amount
        case '006':
          return {
            // Description of the detail
            description: stream.take(30).trim(),

            // Currency (ISO code)
            currency: stream.take(3).trim(),

            // Amount (12 + 3)
            amount:
              (Number(stream.take(12 + 3)) *
                // Sign of the amount
                //
                // 0 = Credit
                // 1 = Debit
                match(stream.take(1), {
                  [Sign.Credit]: 1,
                  [Sign.Debit]: -1,
                })) /
              1_000,

            // Category
            category: Number(stream.take(3).trim()),
          }

        // Information concerning the detail cash
        case '007':
          return {
            // Number of notes / coins
            number: Number(stream.take(7).trim()),

            // Note / coin denomination
            denomination: Number(stream.take(3 + 3).trim()) / 1_000,

            // Total amount
            total: Number(stream.take(12 + 3).trim()) / 1_000,
          }

        // Identification of the de ultimate beneficiary/creditor (SEPA SCT/SDD)
        case '008':
        // Identification of the de ultimate ordering customer/debtor (SEPA SCT/SDD)
        case '009':
          return {
            // Name
            name: stream.take(70).trim(),

            // Identification code
            identification_code: stream.take(35).trim(),
          }

        // Information pertaining to sale or purchase of securities
        case '010':
          return {
            // Order number (number given by the bank)
            order_number: stream.take(13).trim(),

            // Number or reference of the "securities" file (number given by the bank)
            bank_reference_number: stream.take(15).trim(),

            // Customer reference
            customer_reference_number: stream.take(13).trim(),

            // Type of "securities code"
            //
            // 01 = SVM
            // 02 = ISIN (ISO)
            // 04 = Telekurs (Switz.)
            // 05 = Cedol (London)
            // 06 = Cedel (Luxemburg)
            // 07 = Euroclear
            // 08 = Wertpapier (Germany)
            // 09 = EOE (European Options Exchange)
            // 99 = Internal code
            securities_code_type: stream.take(2).trim(),
            get securities_code_type_description() {
              return match(this.securities_code_type, {
                '01': 'SVM',
                '02': 'ISIN (ISO)',
                '04': 'Telekurs (Switz.)',
                '05': 'Cedol (London)',
                '06': 'Cedel (Luxemburg)',
                '07': 'Euroclear',
                '08': 'Wertpapier (Germany)',
                '09': 'EOE (European Options Exchange)',
                '99': 'Internal code',

                [__]: '<Unknown>',
              })
            },

            // Code of the security
            securities_code_value: stream.take(15).trim(),

            // Method of entry
            //
            // N = Nominal
            // U = Per unit
            method: stream.take(1).trim(),

            // Number (12 N (8+4))
            number: Number(stream.take(8 + 4).trim()) / 10_000,

            // Currency of issue (ISO currency code)
            currency: Number(stream.take(3).trim()),

            // Number of security per transaction unit
            //
            // Normal case = 0001
            // Option = number of securities per option (e.g.: 0010, 0100, 0250, 1000, etc.)
            number_per_transaction_unit: Number(stream.take(4).trim()),

            // Currency of quotation (ISO currency code)
            quotation_currency: stream.take(3).trim(),

            // Stock Exchange rate in the currency of quotation (method of quotation = method of entry)
            // 8 + 4 pos N
            stock_exchange_rate: Number(stream.take(8 + 4).trim()) / 10_000,

            // Exchange rate of the currency of quotation in relation to the reference currency
            // 4 + 8 pos N
            exchange_rate: Number(stream.take(4 + 8).trim()) / 100_000_000,

            // Name of the security
            // (3 = nature (alphabetical SVM code), 1 = blanks, 36 = name)
            name: stream.take(40).trim(),

            // Bordereau number
            bordereau_number: stream.take(13).trim(),

            // Number of the coupon attached
            coupon_number: stream.take(8).trim(),

            // Payment day of the coupon
            coupon_payment_date: stream.take(8).trim(),

            // Country, Stock Exchange and market
            country_stock_exchange_market: stream.take(30).trim(),

            // Date of purchase/sale (DDMMMYYYY)
            purchase_sale_date: parseDate(stream.take(8).trim()),

            // Nature of the transaction (e.g.: capital redemption)
            nature: stream.take(24).trim(),

            // Nominal value
            nominal_value: Number(stream.take(12 + 3).trim()) / 1_000,
          }

        // Information pertaining to coupons
        case '011':
          return {
            // Order number (number given by the bank)
            order_number: stream.take(13).trim(),

            // Number or reference of the "securities" file of the client (number given by the bank)
            bank_reference_number: stream.take(15).trim(),

            // Customer reference
            customer_reference_number: stream.take(13).trim(),

            // Type of "securities code"
            // 01 = SVM
            // 02 = ISIN (ISO)
            // 04 = Telekurs (Switz.)
            // 05 = Cedol (London)
            // 06 = Cedel (Luxemburg)
            // 07 = Euroclear
            // 08 = Wertpapier (Germany)
            // 09 = EOE (European Options Exchange)
            // 99 = Internal code
            securities_code_type: stream.take(2).trim(),
            get securities_code_type_description() {
              return match(this.securities_code_type, {
                '01': 'SVM',
                '02': 'ISIN (ISO)',
                '04': 'Telekurs (Switz.)',
                '05': 'Cedol (London)',
                '06': 'Cedel (Luxemburg)',
                '07': 'Euroclear',
                '08': 'Wertpapier (Germany)',
                '09': 'EOE (European Options Exchange)',
                '99': 'Internal code',

                [__]: '<Unknown>',
              })
            },

            // Code of the security
            securities_code_value: stream.take(15).trim(),

            // Number
            number: Number(stream.take(8 + 4).trim()) / 10_000,

            // Name of the security
            // (3 = nature (alphabetical SVM code), 1 = blanks, 36 = name)
            name: stream.take(40).trim(),

            // Currency of issue (ISO currency code)
            currency: stream.take(3).trim(),

            // Amount of coupon
            amount: Number(stream.take(8 + 6).trim()) / 1_000_000,

            // Type of amount (1 = dividend; 2 = interest)
            type: match(stream.take(1).trim(), {
              '1': 'dividend',
              '0': 'interest',
            }),

            // Foreign tax rate (in the currency of payment)
            foreign_tax_rate: Number(stream.take(12 + 3).trim()) / 1_000,

            // Nature of the transaction (e.g.: half-yearly coupon, advance)
            nature: stream.take(24).trim(),

            // Number of the coupon paid
            coupon_number: stream.take(6).trim(),

            // Date (DDMMYY)
            date: parseDate(stream.take(6).trim()),

            // Exchange rate
            exchange_rate: Number(stream.take(4 + 8).trim()) / 100_000_000,

            // Currency chosen for the payment (for payments with option)
            //
            // 3 pos AN (ISO currency code)
            currency_payment: stream.take(3).trim(),

            // Nominal value
            //
            // 15 pos N (12 + 3)
            nominal_value: Number(stream.take(12 + 3).trim()) / 1_000,
          }

        default:
          throw new Error(`Unknown structured communication type`)
      }
    }

    default:
      throw new Error(`Unknown communication type`)
  }
}

function parseCommunicationMovement(line: string, type: 'structured' | 'unstructured') {
  let stream = new StringStream(line)

  switch (type) {
    // None or unstructured
    case 'unstructured':
      return line
    // return stream.take(53)

    // Structured
    case 'structured':
      let structuredType = Number(stream.take(3))
      switch (structuredType) {
        // Payment with a structured format communication applying the ISO standard 11649: Structured
        // creditor reference to remittance information
        case 100:
          return {
            type: structuredType,
            type_description:
              'Payment with a structured format communication applying the ISO standard 11649: Structured creditor reference to remittance information',
            value: stream.take(21).trim(),
          }

        // Credit transfer or cash payment with structured format communication
        case 101:
          return {
            type: structuredType,
            type_description:
              'Credit transfer or cash payment with structured format communication',
            value: stream.take(10 + 2).trim(),
          }

        // Credit transfer or cash payment with reconstituted structured format communication
        case 102:
          return {
            type: structuredType,
            type_description:
              'Credit transfer or cash payment with reconstituted structured format communication',
            value: stream.take(10 + 2).trim(),
          }

        // Number (e.g. of the cheque, of the card, etc.)
        case 103:
          return {
            type: structuredType,
            type_description: 'Number (e.g. of the cheque, of the card, etc.)',
            value: stream.take(12),
          }

        // Original amount of the transaction
        case 105:
          return {
            type: structuredType,
            type_description: 'Original amount of the transaction',

            // Gross amount in the currency of the account
            gross_amount_currency_account: Number(stream.take(12 + 3).trim()) / 1_000,

            // Gross amount in the original currency
            gross_amount_original_currency: Number(stream.take(12 + 3).trim()) / 1_000,

            // Rate
            rate: Number(stream.take(4 + 8).trim()) / 100_000_000,

            // Currency (ISO currency code)
            currency: stream.take(3).trim(),

            // Structured format communication
            structured_format_communication: stream.take(12).trim(),

            // Country code of the principal (ISO country code)
            country_code_principal: stream.take(2).trim(),

            // Equivalent in EUR
            equivalent_eur: Number(stream.take(12 + 3).trim()) / 1_000,
          }

        // Method of calculation (VAT, withholding tax on income, commission, etc.)
        case 106:
          return {
            type: structuredType,
            type_description:
              'Method of calculation (VAT, withholding tax on income, commission, etc.)',

            // Equivalent in the currency of the account
            equivalent_currency_account: Number(stream.take(12 + 3).trim()) / 1_000,

            // Amount on which % in calculated
            amount: Number(stream.take(12 + 3).trim()) / 1_000,

            // Percent
            percent: Number(stream.take(4 + 8).trim()) / 100_000_000,

            // Minimum
            // 1 = Minimum applicable
            // 0 = Minimum not applicable
            minimum: stream.take(1).trim() === '1',

            // Equivalent in EUR
            equivalent_eur: Number(stream.take(12 + 3).trim()) / 1_000,
          }

        // Closing
        case 108:
          return {
            type: structuredType,
            type_description: 'Closing',

            // Equivalent in the currency of the account
            equivalent_currency_account: Number(stream.take(12 + 3).trim()) / 1_000,

            // Interest rates, calculation basis
            interest_rates_calculation_basis: Number(stream.take(15).trim()),

            // Interest
            interest: Number(stream.take(4 + 8).trim()) / 100_000_000,

            // Period from ... to ... (DDMMYYDDMMYY)
            period: {
              from: parseDate(stream.take(6).trim()),
              to: parseDate(stream.take(6).trim()),
            },
          }

        // POS credit - Globalisation
        case 111:
          return {
            type: structuredType,
            type_description: 'POS credit — Globalisation',

            // Card scheme:
            // 1 = Bancontact/Mister Cash
            // 2 = Maestro
            // 3 = Private
            // 5 = TINA
            // 9 = Other
            card_scheme: Number(stream.take(1).trim()),
            get card_scheme_description() {
              return match(this.card_scheme, {
                1: 'Bancontact/Mister Cash',
                2: 'Maestro',
                3: 'Private',
                5: 'TINA',
                9: 'Other',

                [__]: '<Unknown>',
              })
            },

            // POS number
            pos_number: stream.take(6).trim(),

            // Period number
            period_number: stream.take(3).trim(),

            first_transaction: {
              // Sequence number of first transaction
              sequence_number: stream.take(6).trim(),

              // Date of first transaction (DDMMYY)
              date: parseDate(stream.take(6).trim()),
            },

            last_transaction: {
              // Sequence number of last transaction
              sequence_number: stream.take(6).trim(),

              // Date of last transaction (DDMMYY)
              date: parseDate(stream.take(6).trim()),
            },

            // Transaction type
            //
            // 0 = Cumulative
            // 1 = Withdrawal
            // 2 = Cumulative on network
            // 5 = POS others
            // 7 = Distribution sector
            // 8 = Teledata
            // 9 = Fuel
            transaction_type: Number(stream.take(1).trim()),
            get transaction_type_description() {
              return match(this.transaction_type, {
                0: 'Cumulative',
                1: 'Withdrawal',
                2: 'Cumulative on network',
                5: 'POS others',
                7: 'Distribution sector',
                8: 'Teledata',
                9: 'Fuel',

                [__]: '<Unknown>',
              })
            },

            // Identification of terminal
            //
            // 16 = Name
            // 10 = Locality
            identification_terminal: {
              name: stream
                .take(16)
                .trim()
                .replace(/\s{2,}/g, ' '),
              locality: stream
                .take(10)
                .trim()
                .replace(/\s{2,}/g, ' '),
            },
          }

        // ATM/POS debit
        case 113:
          return {
            type: structuredType,
            type_description: 'ATM/POS debit',

            // Masked PAN or card number
            masked_pan: stream.take(16).trim(),

            // Card scheme
            //
            // 1 = Bancontact/Mister Cash
            // 2 = Maestro
            // 3 = Private
            // 5 = TINA
            card_scheme: Number(stream.take(1).trim()),
            get card_scheme_description() {
              return match(this.card_scheme, {
                1: 'Bancontact/Mister Cash',
                2: 'Maestro',
                3: 'Private',
                5: 'TINA',

                [__]: '<Unknown>',
              })
            },

            // Terminal number
            terminal_number: Number(stream.take(6).trim()),

            // Sequence number of transaction
            sequence_number: Number(stream.take(6).trim()),

            date: parseDate(
              stream
                .take(
                  6 + // Date of transaction (DDMMYY)
                    4 // Hour of transaction (HHMM)
                )
                .trim()
            ),

            // Transaction type
            //
            // 1 = Withdrawal
            // 2 = Proton loading
            // 3 = Reimbursement Proton balance
            // 4 = Reversal of purchases
            // 5 = POS others
            // 7 = Distribution sector
            // 8 = Teledata
            // 9 = Fuel
            transaction_type: Number(stream.take(1).trim()),
            get transaction_type_description() {
              return match(this.transaction_type, {
                1: 'Withdrawal',
                2: 'Proton loading',
                3: 'Reimbursement Proton balance',
                4: 'Reversal of purchases',
                5: 'POS others',
                7: 'Distribution sector',
                8: 'Teledata',
                9: 'Fuel',

                [__]: '<Unknown>',
              })
            },

            // Identification of terminal
            //
            // 16 = Name
            // 10 = Town / city
            identification_terminal: {
              name: stream.take(16).trim(),
              city: stream.take(10).trim(),
            },

            // Original amount
            original_amount: Number(stream.take(12 + 3).trim()) / 1_000,

            // Rate
            rate: Number(stream.take(4 + 8).trim()) / 100_000_000,

            // Currency
            currency: stream.take(3).trim(),

            // Volume
            volume: Number(stream.take(3 + 2).trim()) / 100,

            // Product code
            //
            // 01 = Premium with lead substitute
            // 02 = Europremium
            // 03 = Diesel
            // 04 = LPG
            // 06 = Premium plus 98 oct
            // 07 = Regular unleaded
            // 08 = Domestic fuel oil
            // 09 = Lubricants
            // 10 = Petrol
            // 11 = Premium 99+
            // 12 = Avgas
            // 16 = Other types
            product_code: Number(stream.take(2).trim()),
            get product_code_description() {
              return match(this.product_code, {
                1: 'Premium with lead substitute',
                2: 'Europremium',
                3: 'Diesel',
                4: 'LPG',
                6: 'Premium plus 98 oct',
                7: 'Regular unleaded',
                8: 'Domestic fuel oil',
                9: 'Lubricants',
                10: 'Petrol',
                11: 'Premium 99+',
                12: 'Avgas',
                16: 'Other types',

                [__]: '<Unknown>',
              })
            },

            // Unit price
            unit_price: Number(stream.take(2 + 3).trim()) / 100,
          }

        // POS credit - individual transaction
        case 114:
          return {
            type: structuredType,
            type_description: 'POS credit — individual transaction',

            // Card scheme
            //
            // 1 = Bancontact/Mister Cash
            // 2 = Maestro
            // 3 = Private
            // 5 = TINA
            // 9 = Other
            card_scheme: Number(stream.take(1).trim()),
            get card_scheme_description() {
              return match(this.card_scheme, {
                1: 'Bancontact/Mister Cash',
                2: 'Maestro',
                3: 'Private',
                5: 'TINA',
                9: 'Other',

                [__]: '<Unknown>',
              })
            },

            // POS number
            pos_number: stream.take(6).trim(),

            // Period number
            period_number: Number(stream.take(3).trim()),

            // Sequence number of transaction
            sequence_number: Number(stream.take(6).trim()),

            date: parseDate(
              stream
                .take(
                  6 + // Date of transaction (DDMMYY)
                    4 // Hour of transaction (HHMM)
                )
                .trim()
            ),

            // Transaction type
            //
            // 1 = Withdrawal
            // 5 = POS others
            // 7 = Distribution sector
            // 8 = Teledata
            // 9 = Fuel
            transaction_type: Number(stream.take(1).trim()),
            get transaction_type_description() {
              return match(this.transaction_type, {
                1: 'Withdrawal',
                5: 'POS others',
                7: 'Distribution sector',
                8: 'Teledata',
                9: 'Fuel',

                [__]: '<Unknown>',
              })
            },

            // Identification of terminal (16 = Name, 10 = Town / city)
            identification_terminal: {
              name: stream.take(16).trim(),
              city: stream.take(10).trim(),
            },

            // Reference of the transaction
            reference: stream.take(16).trim(),
          }

        // Terminal cash deposit
        case 115:
          return {
            type: structuredType,
            type_description: 'Terminal cash deposit',

            // (Masked) PAN or card number
            masked_pan: stream.take(16).trim(),

            // Card scheme
            //
            // 3 = Private
            // 9 = Other
            card_scheme: Number(stream.take(1).trim()),
            get card_scheme_description() {
              return match(this.card_scheme, {
                3: 'Private',
                9: 'Other',

                [__]: '<Unknown>',
              })
            },

            // Terminal number
            terminal_number: Number(stream.take(6).trim()),

            // Sequence number of transaction
            sequence_number: Number(stream.take(6).trim()),

            payment_day: parseDate(
              stream
                .take(
                  6 + // Payment day (DDMMYY)
                    4 // Hour of payment (HHMM)
                )
                .trim()
            ),

            // Sequence number of validation
            sequence_number_validation: Number(stream.take(6).trim()),

            // Original amount (given by the customer)
            original_amount_customer: Number(stream.take(12 + 3).trim()) / 1_000,

            // Conformity code or blank
            conformity_code: stream.take(1).trim(),

            // Identification of terminal (16 = Name, 10 = Locality)
            identification_terminal: {
              name: stream
                .take(16)
                .trim()
                .replace(/\s{2,}/g, ' '),
              locality: stream
                .take(10)
                .trim()
                .replace(/\s{2,}/g, ' '),
            },

            // Message (structured or free)
            message: stream.take(12).trim(),
          }

        // Commercial bills
        case 121:
          return {
            type: structuredType,
            type_description: 'Commercial bills',

            // Amount of the bill
            amount: Number(stream.take(12 + 3).trim()) / 1_000,

            // Maturity date of the bill (DDMMYY)
            maturity_date: parseDate(stream.take(6).trim()),

            // Conventional Maturity date (Conventional maturity for periodic discounts)
            conventional_maturity_date: parseDate(stream.take(6).trim()),

            // Date of issue of the bill (DDMMYY)
            issue_date: parseDate(stream.take(6).trim()),

            // Company number (0 + company number)
            company_number: stream.take(1 + 10).trim(),

            // Currency (ISO currency code)
            currency: stream.take(3).trim(),

            // Number of the bill
            number: stream.skip(3).take(13).trim(),

            // Exchange rate
            exchange_rate: Number(stream.take(4 + 8).trim()) / 100_000_000,
          }

        // Bills - calculation of interest
        case 122:
          return {
            type: structuredType,
            type_description: 'Bills — calculation of interest',

            // Number of days
            number_of_days: Number(stream.take(4).trim()),

            // Interest rate
            interest_rate: Number(stream.take(4 + 8).trim()) / 100_000_000,

            // Basic amount of the calculation
            basic_amount: Number(stream.take(12 + 3).trim()) / 1_000,

            // Minimum rate
            //
            // 1 = Minimum applicable
            // 2 = Minimum not applicable
            minimum_rate: stream.take(1).trim() === '1',

            // Number of the bill
            number: stream.take(13).trim(),

            // Maturity date of the bill (DDMMYY)
            maturity_date: parseDate(stream.take(6).trim()),
          }

        // Fees and commissions
        case 123:
          return {
            type: structuredType,
            type_description: 'Fees and commissions',

            // Starting date (DDMMYY)
            starting_date: parseDate(stream.take(6).trim()),

            // Maturity date (DDMMYY) if guarantee without fixed term: 999999
            maturity_date: parseDate(stream.take(6).trim()),

            // Basic amount
            basic_amount: Number(stream.take(12 + 3).trim()) / 1_000,

            // Percentage
            percentage: Number(stream.take(4 + 8).trim()) / 100_000_000,

            // Term in days
            term_in_days: Number(stream.take(4).trim()),

            // Minimum rate
            //
            // 1 = Minimum applicable
            // 2 = Minimum not applicable
            minimum_rate: stream.take(1).trim() === '1',

            // Guarantee number (no. allocated by the bank)
            guarantee_number: stream.take(13).trim(),
          }

        // Number of the credit card
        case 124:
          return {
            type: structuredType,
            type_description: 'Number of the credit card',

            // Masked PAN or card number
            masked_pan: stream.take(20).trim(),

            // Issuing institution
            //
            // 1 = Mastercard
            // 2 = Visa
            // 3 = American Express
            // 4 = Diners Club
            // 9 = Other
            issuing_institution: Number(stream.take(1).trim()),
            get issuing_institution_description() {
              return match(this.issuing_institution, {
                1: 'Mastercard',
                2: 'Visa',
                3: 'American Express',
                4: 'Diners Club',
                9: 'Other',

                [__]: '<Unknown>',
              })
            },

            // Invoice number (is used when the credit card issuer allocates a sequence number to
            // the invoices)
            invoice_number: stream.take(12).trim(),

            // Identification number (is used for credit card issuers who centralize the information
            // on the card(s) under the client identification number)
            identification_number: stream.take(15).trim(),

            // Date
            date: parseDate(stream.take(6).trim()),
          }

        // Credit
        case 125:
          return {
            type: structuredType,
            type_description: 'Credit',

            // Account number of the credit
            account_number: stream.take(12).trim(),

            // Extension zone of account number of the credit
            extension_zone_account_number: stream.take(15).trim(),

            // Old balance of the credit
            old_balance: Number(stream.take(12 + 3).trim()) / 1_000,

            // New balance of the credit
            new_balance: Number(stream.take(12 + 3).trim()) / 1_000,

            // Amount (equivalent in foreign currency)
            amount: Number(stream.take(12 + 3).trim()) / 1_000,

            // Currency (ISO currency code)
            currency: stream.take(3).trim(),

            // Starting date (DDMMYY)
            start_date: parseDate(stream.take(6).trim()),

            // End date (DDMMYY)
            end_date: parseDate(stream.take(6).trim()),

            // Nominal interest rate or rate of charge
            nominal_interest_rate: Number(stream.take(4 + 8).trim()) / 100_000_000,

            // Reference of transaction on credit account
            reference: stream.take(13).trim(),
          }

        // Term investments
        case 126:
          return {
            type: structuredType,
            type_description: 'Term investments',

            // Deposit number
            deposit_number: stream.take(15).trim(),

            // Deposit amount
            deposit_amount: Number(stream.take(12 + 3).trim()) / 1_000,

            // Equivalent in the currency of the account
            equivalent_currency_account: Number(stream.take(12 + 3).trim()) / 1_000,

            // Starting date (DDMMYY)
            start_date: parseDate(stream.take(6).trim()),

            // End date (DDMMYY)
            end_date: parseDate(stream.take(6).trim()),

            // Interest rate
            interest_rate: Number(stream.take(4 + 8).trim()) / 100_000_000,

            // Amount of interest
            amount_of_interest: stream.take(15).trim(),

            // Currency (ISO currency code)
            currency: stream.take(3).trim(),

            // Rate
            rate: Number(stream.take(4 + 8).trim()) / 100_000_000,
          }

        // European direct debit (SEPA)
        case 127:
          return {
            type: structuredType,
            type_description: 'European direct debit (SEPA)',

            // Settlement date (DDMMYY)
            settlement_date: parseDate(stream.take(6).trim()),

            // Type direct debit
            //
            // 0 = Unspecified
            // 1 = Recurrent
            // 2 = One-off
            // 3 = 1st (Recurrent)
            // 4 = Last (Recurrent)
            type_direct_debit: Number(stream.take(1).trim()),
            get type_direct_debit_description() {
              return match(this.type_direct_debit, {
                0: 'Unspecified',
                1: 'Recurrent',
                2: 'One-off',
                3: '1st (Recurrent)',
                4: 'Last (Recurrent)',

                [__]: '<Unknown>',
              })
            },

            // Direct debit scheme
            //
            // 0 = Unspecified
            // 1 = SEPA core
            // 2 = SEPA B2B
            direct_debit_scheme: Number(stream.take(1).trim()),
            get direct_debit_scheme_description() {
              return match(this.direct_debit_scheme, {
                0: 'Unspecified',
                1: 'SEPA core',
                2: 'SEPA B2B',

                [__]: '<Unknown>',
              })
            },

            // Paid or reason for refused payment
            //
            // 0 = Paid
            // 1 = Technical problem
            // 2 = Reason not specified
            // 3 = Debtor disagrees
            // 4 = Debtor's account problem
            paid_or_reason_for_refused_payment: Number(stream.take(1).trim()),
            get paid_or_reason_for_refused_payment_description() {
              return match(this.paid_or_reason_for_refused_payment, {
                0: 'Paid',
                1: 'Technical problem',
                2: 'Reason not specified',
                3: 'Debtor disagrees',
                4: "Debtor's account problem",

                [__]: '<Unknown>',
              })
            },

            // Creditor's identification code
            creditor_identification_code: stream.take(35).trim(),

            // Mandate reference
            mandate_reference: stream.take(35).trim(),

            // Communication
            communication: stream.take(62).trim(),

            // Type of R transaction
            //
            // 0 = Paid
            // 1 = Reject
            // 2 = Return
            // 3 = Refund
            // 4 = Reversal
            // 5 = Cancellation
            type_of_r_transaction: Number(stream.take(1).trim()),
            get type_of_r_transaction_description() {
              return match(this.type_of_r_transaction, {
                0: 'Paid',
                1: 'Reject',
                2: 'Return',
                3: 'Refund',
                4: 'Reversal',
                5: 'Cancellation',

                [__]: '<Unknown>',
              })
            },

            // Reason
            reason: stream.take(4).trim(),
          }

        default:
          throw new Error(`Unknown structured movement communication type`)
      }

    default:
      throw new Error('Unknown movement communication type')
  }
}

// Date formats:
function parseDate(input: string) {
  let stream = new StringStream(input)

  switch (input.length) {
    // DDMMYY
    case 6: {
      let day = stream.take(2)
      let month = stream.take(2)
      let year = stream.take(2)

      return new Date(`${(new Date().getFullYear() / 100) | 0}${year}-${month}-${day}`)
    }

    // DDMMYYYY
    case 8: {
      let day = stream.take(2)
      let month = stream.take(2)
      let year = stream.take(4)

      return new Date(`${year}-${month}-${day}`)
    }

    // DDMMYYHHMM
    case 10: {
      let day = stream.take(2)
      let month = stream.take(2)
      let year = stream.take(2)
      let hour = stream.take(2)
      let minute = stream.take(2)

      return new Date(`${year}-${month}-${day} ${hour}:${minute}:00`)
    }

    default:
      throw new Error(`Unknown date format: ${input}`)
  }
}

enum Sign {
  Credit = '0',
  Debit = '1',
}

let Duplicate = 'D'
let UnknownDate = '000000'
