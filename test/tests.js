/**
 * Mocha tests of the Topcoder - MM Submission Legacy Processor Application.
 */
process.env.NODE_ENV = 'test'
require('legacy-processor-module/bootstrap')

const Axios = require('axios')
const config = require('config')
const Kafka = require('no-kafka')
const should = require('should')

const _ = require('lodash')

const logger = require('legacy-processor-module/common/logger')
const constant = require('legacy-processor-module/common/constant')
const {getKafkaOptions} = require('legacy-processor-module/KafkaConsumer')
const {patchSubmission} = require('legacy-processor-module/LegacySubmissionIdService')
const {sleep, expectTable, clearSubmissions, queryInformix} = require('legacy-processor-module/test/TestHelper')

const {
  mockApi,
  sampleMMSubmission,
  sampleMMProvisionalReview,
  sampleMMFinalReview,
  sampleMMSubmission2,
  sampleMMProvisionalReview2,
  sampleMMFinalReview2
} = require('legacy-processor-module/mock/mock-api')

// Default timeout
const timeout = 1000
const header = {
  topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
  originator: config.KAFKA_NEW_SUBMISSION_ORIGINATOR,
  timestamp: '2018-02-16T00:00:00',
  'mime-type': 'application/json'
}

// The good mm sample message
const sampleMMMessage = {
  ...header,
  payload: {
    ...sampleMMSubmission
  }
}

// The good mm review provisional sample message
const sampleMMReviewProvisionalMessage = {
  ...header,
  payload: {
    ...sampleMMProvisionalReview
  }
}

// The good mm review final sample message
const sampleMMReviewFinalMessage = {
  ...header,
  payload: {
    ...sampleMMFinalReview
  }
}

// The good mm sample message
const sampleMMMessage2 = {
  ...header,
  payload: {
    ...sampleMMSubmission2
  }
}

// The good mm review provisional sample message
const sampleMMReviewProvisionalMessage2 = {
  ...header,
  payload: {
    ...sampleMMProvisionalReview2
  }
}

// The good mm review final sample message
const sampleMMReviewFinalMessage2 = {
  ...header,
  payload: {
    ...sampleMMFinalReview2
  }
}

const options = getKafkaOptions()
const producer = new Kafka.Producer(options)

describe('Topcoder - Submission Legacy Processor Application', () => {
  // Inject the logger to validate the message
  let logMessages = []
  let consumer
  ['debug', 'info', 'error', 'warn'].forEach((level) => {
    logger[level] = (message) => {
      logMessages.push(message + '')
    }
  })
  /**
   * Wait job finish with completed handing or failed to handle found in log messages
   */
  const waitJob = async () => {
    // will not loop forever for timeout configuration of mocha
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // sleep at first to ensure consume message
      await sleep(timeout)
      // break if completed handing or failed to handle
      if (logMessages.find(x => x.startsWith('Skipped') || x.startsWith('Successfully processed') || x.startsWith('Failed to handle'))) {
        break
      }
    }
  }
  /**
   * Start http server with port
   * @param {Object} server the server
   * @param {Number} port the server port
   */
  const startServer = (server, port) => new Promise((resolve) => {
    server.listen(port, () => {
      resolve()
    })
  })

  /**
   * Close http server
   */
  const closeServer = (server) => new Promise((resolve) => {
    server.close(() => {
      resolve()
    })
  })
  before(async () => {
    await startServer(mockApi, config.MOCK_API_PORT)
    // consume not processed messages before test
    const groupConsumer = new Kafka.GroupConsumer(options)
    await groupConsumer.init([{
      subscriptions: [config.KAFKA_NEW_SUBMISSION_TOPIC],
      handler: (messageSet, topic, partition) =>
        Promise.each(messageSet, (m) =>
          groupConsumer.commitOffset({ topic, partition, offset: m.offset }))
    }])
    await sleep(2000)
    await groupConsumer.end()
    await producer.init()
    // Start the app
    consumer = require('../index')
    // Make sure producer, consumer has enough time to initialize
    await sleep(5000)
  })

  after(async () => {
    await clearSubmissions()
    // close server
    await closeServer(mockApi)
    try {
      await producer.end()
    } catch (err) {
      // ignore
    }
    try {
      await consumer.end()
    } catch (err) {
      // ignore
    }
  })

  beforeEach(async () => {
    logMessages = []
  })

  it('Should setup healthcheck with check on kafka connection', async () => {
    const healthcheckEndpoint = `http://localhost:${process.env.PORT || 3000}/health`
    let result = await Axios.get(healthcheckEndpoint)
    should.equal(result.status, 200)
    should.deepEqual(result.data, { checksRun: 1 })
  })

  it('should not consume message from a different topic', async () => {
    await producer.send({ topic: 'different-topic', message: { value: 'message' } })
    await sleep(timeout)
    // no logs after wait sometime
    should.equal(logMessages.length, 0)
  })

  it('should skip message with null value', async () => {
    const m = { topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: null } }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped null or empty event')
  })

  it('should skip message with null string value', async () => {
    const m = { topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: 'null' } }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped null or empty event')
  })

  it('should skip message with empty value', async () => {
    const m = { topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: '' } }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped null or empty event')
  })

  it('should skip message with non-well-formed JSON string value', async () => {
    const m = { topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: 'abc' } }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped Invalid message JSON')
  })

  it('should skip message with wrong topic value', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          topic: 'wrong-topic'
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], `Skipped the message topic "wrong-topic" doesn't match the Kafka topic ${config.KAFKA_NEW_SUBMISSION_TOPIC}.`)
  })

  it('should skip message with invalid timestamp', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          timestamp: 'invalid date'
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped invalid event, reasons: "timestamp" must be a number of milliseconds or valid date string')
  })

  it('should skip message with invalid payload value', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          payload: {
            challengeId: 'a',
            memberId: 'b',
            url: 'invalid url',
            type: null,
            submissionPhaseId: 333
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped invalid event, reasons: "challengeId" must be a number, "memberId" must be a number, "type" must be a string, "url" must be a valid uri')
  })

  it('should skip message with wrong originator value', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          originator: 'wrong-originator'
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped event from originator wrong-originator')
  })

  it('should skip message with null id value', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          payload: {
            id: null
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped invalid event, reasons: "id" must be a number, "id" must be a string')
  })

  it('should skip message with zero id value', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          payload: {
            id: 0
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped invalid event, reasons: "id" must be a positive number, "id" must be a string')
  })

  it('should skip message with null challengeId value', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          payload: {
            challengeId: null
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped invalid event, reasons: "challengeId" must be a number')
  })

  it('should skip message with zero challengeId value', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          payload: {
            challengeId: 0
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped invalid event, reasons: "challengeId" must be a positive number')
  })

  it('should skip message with null memberId value', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          payload: {
            memberId: null
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped invalid event, reasons: "memberId" must be a number')
  })

  it('should skip message with zero memberId value', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          payload: {
            memberId: 0
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped invalid event, reasons: "memberId" must be a positive number')
  })

  it('should skip message with null url value', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          payload: {
            url: null
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped invalid event, reasons: "url" must be a string')
  })

  it('should skip message with invalid url value', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          payload: {
            url: 'invalid'
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped invalid event, reasons: "url" must be a valid uri')
  })

  it('should skip message with null type value', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          payload: {
            type: null
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped invalid event, reasons: "type" must be a string')
  })

  it('should skip message with empty type value', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          payload: {
            type: ''
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped invalid event, reasons: "type" is not allowed to be empty')
  })

  it('should skip review message with invalid test type', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMReviewProvisionalMessage, {
          payload: {
            metadata: {
              testType: 'invalidTestType'
            }
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped non-provisional testType: invalidTestType')
  })

  it('should skip review message with invalid score', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMReviewProvisionalMessage, {
          payload: {
            score: -90
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.equal(logMessages[1], 'Skipped invalid event, reasons: "score" must be larger than or equal to 0')
  })

  it('should skip submission message which is not MM challenge', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          payload: {
            challengeId: 30005530
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.ok(logMessages.find(x => x.startsWith(`Skipped as NOT MM`)))
  })

  it('should skip review message which is not MM challenge', async () => {
    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMReviewProvisionalMessage, {
          payload: {
            submissionId: 111
          }
        }))
      }
    }
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.ok(logMessages.find(x => x.startsWith(`Skipped as NOT MM`)))
  })

  it('should handle new mm challenge submission(not found challenge in database) message successfully', async () => {
    await clearSubmissions()

    const m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          payload: {
            challengeId: 30054164,
            submissionPhaseId: 95321
          }
        }))
      }
    }
    logMessages = []
    let results = await producer.send(m)
    await waitJob()
    let messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(3)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.ok(logMessages.find(x => x.startsWith(`Failed to handle`)))
    should.ok(logMessages.find(x => x.includes('null or empty result get mm challenge properties')))

    // The transaction should be rolled back
    await expectTable('upload', 0, {
      project_id: 30054164,
      project_phase_id: 95321
    })
  })

  it('should handle new mm challenge submission message successfully', async () => {
    await clearSubmissions()

    const m = { topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: JSON.stringify(sampleMMMessage) } }
    let results = await producer.send(m)
    await waitJob()
    let messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(5)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.ok(logMessages.find(x => x.startsWith('insert round_registration with params')))
    should.ok(logMessages.find(x => x.startsWith('insert long_component_state with params')))
    should.ok(logMessages.find(x => x.startsWith('insert long_submission with params')))
    should.ok(logMessages.find(x => x.startsWith('Successfully processed MM message - Patched to the Submission API')))

    await expectTable('informixoltp:round_registration', 1, {
      coder_id: sampleMMMessage.payload.memberId,
      eligible: 1
    })
    await expectTable('informixoltp:long_component_state', 1, {
      points: 0,
      status_id: constant.COMPONENT_STATE.ACTIVE,
      submission_number: 1,
      example_submission_number: 0,
      coder_id: sampleMMMessage.payload.memberId
    })
    await expectTable('informixoltp:long_submission', 1, {
      submission_number: 1,
      submit_time: Date.parse(sampleMMMessage.payload.created),
      example: 0
    })

    // process second time
    logMessages = []
    results = await producer.send(m)
    await waitJob()
    messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    should.ok(logMessages.find(x => x.startsWith('round_registration already exists')))
    should.ok(logMessages.find(x => x.startsWith('increment long_component_state#submission_number by 1')))
    should.ok(logMessages.find(x => x.startsWith('insert long_submission with params')))
    should.ok(logMessages.find(x => x.startsWith('Successfully processed MM message - Patched to the Submission API')))

    await expectTable('informixoltp:round_registration', 1, {
      coder_id: sampleMMMessage.payload.memberId,
      eligible: 1
    })
    await expectTable('informixoltp:long_component_state', 1, {
      points: 0,
      status_id: constant.COMPONENT_STATE.ACTIVE,
      submission_number: 2,
      example_submission_number: 0,
      coder_id: sampleMMMessage.payload.memberId
    })
    await expectTable('informixoltp:long_submission', 1, {
      submission_number: 1,
      submit_time: Date.parse(sampleMMMessage.payload.created),
      example: 0
    })
    await expectTable('informixoltp:long_submission', 1, {
      submission_number: 2,
      submit_time: Date.parse(sampleMMMessage.payload.created),
      example: 0
    })
  })

  it('should handle update submission message successfully', async () => {
    await clearSubmissions()

    await producer.send({ topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: JSON.stringify(sampleMMMessage) } })
    await waitJob()

    await patchSubmission(sampleMMMessage.payload.id, {legacySubmissionId: null})

    await expectTable('upload', 1, {
      project_id: sampleMMMessage.payload.challengeId,
      project_phase_id: sampleMMMessage.payload.submissionPhaseId,
      url: sampleMMMessage.payload.url
    })

    const updatedUrl = 'http://content.topcoder.com/some/path/updated'
    const m = {
      topic: config.KAFKA_UPDATE_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          topic: config.KAFKA_UPDATE_SUBMISSION_TOPIC,
          payload: {
            url: updatedUrl
          }
        }))
      }
    }

    logMessages = []
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(3)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.ok(logMessages.find(x => x.startsWith('Error: legacySubmissionId not found for submission')))
  })

  it('should handle update submission message(newer with legacySubmissionId) successfully', async () => {
    await clearSubmissions()

    await producer.send({ topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: JSON.stringify(sampleMMMessage) } })
    await waitJob()

    await expectTable('upload', 1, {
      project_id: sampleMMMessage.payload.challengeId,
      project_phase_id: sampleMMMessage.payload.submissionPhaseId,
      url: sampleMMMessage.payload.url
    })

    const updatedUrl = 'http://content.topcoder.com/some/path/legacyupdated'
    const m = {
      topic: config.KAFKA_UPDATE_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMMessage, {
          topic: config.KAFKA_UPDATE_SUBMISSION_TOPIC,
          payload: {
            url: updatedUrl
          }
        }))
      }
    }

    logMessages = []
    const results = await producer.send(m)
    await waitJob()
    const messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(2)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.not.exist(logMessages.find(x => x.startsWith('no valid submission id')))
    should.ok(logMessages.find(x => x.startsWith('Successfully processed MM message - Submission url updated, legacy submission id')))

    await expectTable('upload', 1, {
      project_id: sampleMMMessage.payload.challengeId,
      project_phase_id: sampleMMMessage.payload.submissionPhaseId,
      url: updatedUrl
    })
  })

  it('should handle (review provisional) mm challenge message successfully', async () => {
    await clearSubmissions()

    let m = { topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: JSON.stringify(sampleMMMessage) } }
    await producer.send(m)
    await waitJob()

    m = { topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: JSON.stringify(sampleMMReviewProvisionalMessage) } }
    logMessages = []
    let results = await producer.send(m)
    await waitJob()
    let messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(5)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.ok(logMessages.find(x => x.startsWith('Successfully processed MM message - Provisional score updated')))

    let message = logMessages.find(x => x.startsWith('Update provisional score for submission: '))
    const submissionId = parseInt(message.replace('Update provisional score for submission: ', ''))

    message = logMessages.find(x => x.startsWith('Get componentStateId: '))
    const componentStateId = parseInt(message.replace('Get componentStateId: ', ''))

    message = logMessages.find(x => x.startsWith('Get submission number: '))
    const submissionNumber = parseInt(message.replace('Get submission number: ', ''))

    await expectTable('submission', 1, {
      submission_id: submissionId,
      initial_score: sampleMMReviewProvisionalMessage.payload.score
    })
    await expectTable('informixoltp:long_component_state', 1, {
      long_component_state_id: componentStateId,
      points: sampleMMReviewProvisionalMessage.payload.score
    })
    await expectTable('informixoltp:long_submission', 1, {
      long_component_state_id: componentStateId,
      submission_number: submissionNumber,
      example: 0,
      submission_points: sampleMMReviewProvisionalMessage.payload.score
    })
  })

  it('should handle (review final) mm challenge message successfully', async () => {
    await clearSubmissions()
    await queryInformix('update informixoltp:round set rated_ind=0 where round_id=2001')

    // Create 2 MM submissions and update their provisional score
    logMessages = []
    let m = { topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: JSON.stringify(sampleMMMessage) } }
    await producer.send(m)
    await waitJob()

    logMessages = []
    m = { topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: JSON.stringify(sampleMMReviewProvisionalMessage) } }
    await producer.send(m)
    await waitJob()

    logMessages = []
    m = { topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: JSON.stringify(sampleMMMessage2) } }
    await producer.send(m)
    await waitJob()

    logMessages = []
    m = { topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: JSON.stringify(sampleMMReviewProvisionalMessage2) } }
    await producer.send(m)
    await waitJob()

    // Update one submission's final score
    logMessages = []
    m = { topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: JSON.stringify(sampleMMReviewFinalMessage) } }
    let results = await producer.send(m)
    await waitJob()
    let messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(3)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.ok(logMessages.find(x => x.startsWith('Successfully processed MM message - Final score updated')))

    let message = logMessages.find(x => x.startsWith('Update final score for submission: '))
    let submissionId = parseInt(message.replace('Update final score for submission: ', ''))

    message = logMessages.find(x => x.startsWith('Get roundId: '))
    let roundId = parseInt(message.replace('Get roundId: ', ''))

    await expectTable('submission', 1, {
      submission_id: submissionId,
      final_score: sampleMMReviewFinalMessage.payload.aggregateScore
    })

    await expectTable('informixoltp:long_comp_result', 1, {
      round_id: roundId,
      coder_id: sampleMMMessage.payload.memberId,
      point_total: sampleMMReviewProvisionalMessage.payload.score,
      system_point_total: sampleMMReviewFinalMessage.payload.aggregateScore,
      rated_ind: 0,
      old_rating: null,
      old_vol: null,
      placed: 1
    })

    // Update another submission's final score
    await queryInformix('update informixoltp:round set rated_ind=1 where round_id=2001')
    await queryInformix(`insert into informixoltp:long_comp_result(round_id, coder_id, new_rating, new_vol, rated_ind) values (1000, ${sampleMMMessage2.payload.memberId}, null, null, 1)`)
    logMessages = []
    m = { topic: config.KAFKA_NEW_SUBMISSION_TOPIC, message: { value: JSON.stringify(sampleMMReviewFinalMessage2) } }
    results = await producer.send(m)
    await waitJob()
    messageInfo = `Topic: ${results[0].topic}; Partition: ${results[0].partition}; Offset: ${results[0].offset}; Message: ${m.message.value}.`
    logMessages.length.should.be.greaterThanOrEqual(3)
    should.equal(logMessages[0], `Handle Kafka event message; ${messageInfo}`)
    should.ok(logMessages.find(x => x.startsWith('Successfully processed MM message - Final score updated')))
    message = logMessages.find(x => x.startsWith('Update final score for submission: '))
    submissionId = parseInt(message.replace('Update final score for submission: ', ''))

    await expectTable('submission', 1, {
      submission_id: submissionId,
      final_score: sampleMMReviewFinalMessage2.payload.aggregateScore
    })

    await expectTable('informixoltp:long_comp_result', 1, {
      round_id: roundId,
      coder_id: sampleMMMessage2.payload.memberId,
      point_total: sampleMMReviewProvisionalMessage2.payload.score,
      system_point_total: sampleMMReviewFinalMessage2.payload.aggregateScore,
      rated_ind: 1,
      old_rating: null,
      old_vol: null,
      placed: 1
    })

    // Check place is correct
    await expectTable('informixoltp:long_comp_result', 1, {
      round_id: roundId,
      coder_id: sampleMMMessage.payload.memberId,
      placed: 2
    })

    // Update final score again, place should be recalculated, rated_ind/old_rating/old_vol should be updated
    // Round 2000 has rated_ind as 0 and null new_rating/new_vol
    // Round 1000 has rated_ind as 1 and non-null new_rating/new_vol
    // Round 1000's new_rating/new_vol should be used
    await queryInformix(`insert into informixoltp:long_comp_result(round_id, coder_id, new_rating, new_vol, rated_ind) values (2000, ${sampleMMMessage2.payload.memberId}, null, null, 0)`)
    await queryInformix(`update informixoltp:long_comp_result set new_rating=1100, new_vol=1200 where round_id=1000 and coder_id=${sampleMMMessage2.payload.memberId}`)
    m = {
      topic: config.KAFKA_NEW_SUBMISSION_TOPIC,
      message: {
        value: JSON.stringify(_.merge({}, sampleMMReviewFinalMessage2, {
          payload: {
            aggregateScore: sampleMMReviewFinalMessage.payload.aggregateScore - 1
          }
        }))
      }
    }
    logMessages = []
    await producer.send(m)
    await waitJob()

    await expectTable('informixoltp:long_comp_result', 1, {
      round_id: roundId,
      coder_id: sampleMMMessage.payload.memberId,
      placed: 1
    })

    await expectTable('informixoltp:long_comp_result', 1, {
      round_id: roundId,
      coder_id: sampleMMMessage2.payload.memberId,
      point_total: sampleMMReviewProvisionalMessage2.payload.score,
      system_point_total: sampleMMReviewFinalMessage.payload.aggregateScore - 1,
      placed: 2,
      rated_ind: 1,
      old_rating: 1100,
      old_vol: 1200
    })
  })
})
