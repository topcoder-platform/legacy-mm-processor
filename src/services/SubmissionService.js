/**
 * The service to handle new submission events for MM challenge.
 */
const _ = require('lodash');
const config = require('config');
const Joi = require('joi');

const logger = require('legacy-processor-module/common/logger');
const Schema = require('legacy-processor-module/Schema');
const LegacySubmissionIdService = require('legacy-processor-module/LegacySubmissionIdService');
const { executeQuery } = require('legacy-processor-module/Informix');
const axios = require('axios');
const m2mAuth = require('tc-core-library-js').auth.m2m;

const m2m = m2mAuth(
  _.pick(config, ['AUTH0_URL', 'AUTH0_AUDIENCE', 'TOKEN_CACHE_TIME', 'AUTH0_PROXY_SERVER_URL'])
);

// db informix option
const dbOpts = {
  server: config.DB_SERVER,
  database: config.DB_NAME,
  host: config.DB_HOST,
  protocol: config.DB_PROTOCOL,
  port: config.DB_PORT,
  username: config.DB_USERNAME,
  password: config.DB_PASSWORD,
  locale: config.DB_LOCALE,
};

// The event schema for "submission" resource
const submissionSchema = Schema.createEventSchema({
  id: Joi.sid().required(),
  resource: Joi.string().valid('submission'),
  challengeId: Joi.id().required(),
  memberId: Joi.id().required(),
  submissionPhaseId: Joi.sid().required(),
  v5ChallengeId: Joi.string().uuid(),
  type: Joi.string().required(),
  url: Joi.string()
    .uri()
    .required()
});

// The event schema for "review" resource
const reviewSchema = Schema.createEventSchema({
  id: Joi.sid().required(),
  resource: Joi.string().valid('review'),
  submissionId: Joi.sid().required(),
  score: Joi.number()
    .min(0)
    .max(100)
    .required(),
  metadata: Joi.object()
    .keys({
      testType: Joi.string().required()
    })
    .unknown(true)
    .optional()
});

// The event schema for "reviewSummation" resource
const reviewSummationSchema = Schema.createEventSchema({
  id: Joi.sid().required(),
  resource: Joi.string().valid('reviewSummation'),
  submissionId: Joi.sid().required(),
  aggregateScore: Joi.number()
    .min(0)
    .max(100)
    .required()
});

const schemas = {
  submission: submissionSchema,
  review: reviewSchema,
  reviewSummation: reviewSummationSchema
};

/**
 * Validate submission field
 * @param {Object} submission the submission got from Submission API
 * @param {String} field the field name
 * @private
 */
function validateSubmissionField(submission, field) {
  if (!submission[field]) {
    throw new Error(`${field} not found for submission: ${submission.id}`);
  }
}

/**
 * Test if the id is UUID
 * @param {String} id the id
 * @returns {Boolean} true if it's a uuid
 */
function isUuid (id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
}

/**
 * Get phase name from phase id
 * @param {String} challengeUuid v5 challenge id
 * @param {*} phaseId v5 submission phase id
 * @returns {String} phase name
 */
async function getPhaseName (challengeUuid, phaseId) {
  const token = await m2m.getMachineToken(config.AUTH0_CLIENT_ID, config.AUTH0_CLIENT_SECRET);
  const res = await axios.get(`${config.V5_CHALLENGE_API_URL}/${challengeUuid}`, { headers: { Authorization: `Bearer ${token}` } });
  return _.get(_.find(_.get(res, 'data.phases', []), ['id', phaseId]), 'name');
}

/**
 * Get submission phase id
 * @param {Object} connection Informix db connectio object
 * @param {Number} challengeId challenge id
 * @param {String} phaseName phase name
 * @returns {Number} phase id
 */
async function getChallengePhaseId (challengeId, phaseName) {
  // The query to get phaseId
  const query = `select p.project_phase_id from project_phase p, phase_type_lu ptl
    where p.project_id = ${challengeId} and p.phase_type_id = ptl.phase_type_id and ptl.name = '${phaseName}'`;

    logger.debug(`print query: ${query}`);
    const result = await executeQuery(dbOpts, query);
    if (result.length === 0) {
      throw new Error(`Empty result get phaseId for: challengeId ${challengeId}, phaseName ${phaseName}`);
    }
    logger.debug('print result:' + JSON.stringify(result));
    return Number(result[0].project_phase_id);
}

/**
 * Check challenge is MM.
 * It returns an array, the first value indicates whether this is a MM challenge, the second
 * value is the submission got from Submission API (when event is from 'review' and 'reviewSummation' resources).
 *
 * @param {Object} event the kafka event
 * @returns {Array} [isMM, submission]
 * @private
 */
async function checkMMChallenge(event) {
  let challengeId;
  let submission; // This is the submission got from Submission API

  try {
    if (event.payload.resource === 'submission') {
      challengeId = event.payload.challengeId;
      // Change v5 submissionPhaseId to legacy submissionPhaseId
      if (isUuid(event.payload.submissionPhaseId)) {
        const phaseName = await getPhaseName(event.payload.v5ChallengeId, event.payload.submissionPhaseId);
        if (phaseName) {
          event.payload.submissionPhaseId = await getChallengePhaseId(event.payload.challengeId, phaseName);
        }
        logger.debug(`set submissionPhaseId ${event.payload.submissionPhaseId}`);
      }
    } else {
      // Event from 'review' and 'reviewSummation' resources does not have challengeId, but has submissionId instead
      // We at first get submission from Submission API, the get challengeId from it
      submission = await LegacySubmissionIdService.getSubmission(
        event.payload.submissionId
      );
      validateSubmissionField(submission, 'challengeId');
      challengeId = submission.challengeId;
    }

    // Validate subTrack to be MM
    const subTrack = await LegacySubmissionIdService.getSubTrack(challengeId);
    logger.debug(`Challenge get subTrack ${subTrack}`);
    const challangeSubtracks = config.CHALLENGE_SUBTRACK.split(',').map(x =>
      x.trim()
    );
    if (!(subTrack && challangeSubtracks.includes(subTrack))) {
      logger.debug(
        `Skipped as NOT MM found in ${JSON.stringify(challangeSubtracks)}`
      );
      return [false];
    }

    return [true, submission];
  } catch (error) {
    logger.error(
      `checkMMChallenge - Failed to handle ${JSON.stringify(event)}: ${
        error.message
      }`
    );
    logger.error(error);
    throw error;
  }
}

/**
 * Handle new submission and update submission event.
 * @param {Object} event the event object
 */
async function handle(event) {
  if (!event) {
    logger.debug('Skipped null or empty event');
    return;
  }

  // Validate with common event schema
  if (!Schema.validateEvent(event, Schema.commonEventSchema)) {
    return;
  }

  // Validate with specific event schema
  const validationResult = Schema.validateEvent(
    event,
    schemas[event.payload.resource]
  );
  if (!validationResult) {
    return;
  }

  // Check topic and originator
  if (event.topic !== config.KAFKA_AGGREGATE_SUBMISSION_TOPIC) {
    logger.debug(`Skipped event from topic ${event.topic}`);
    return;
  }

  if (event.originator !== config.KAFKA_NEW_SUBMISSION_ORIGINATOR) {
    logger.debug(`Skipped event from originator ${event.originator}`);
    return;
  }

  if (event.payload.resource === 'review') {
    const testType = _.get(event, 'payload.metadata.testType');
    if (testType !== 'provisional') {
      logger.debug(`Skipped non-provisional testType: ${testType}`);
      return;
    }
  }

  // Validate challenge is MM
  const [isMM, submission] = await checkMMChallenge(event);
  if (!isMM) {
    logger.debug(
      `submission ${submission} is not a marathon. skipping processing`
    );
    return;
  }

  if (
    event.payload.resource === 'submission' &&
    event.payload.originalTopic === config.KAFKA_NEW_SUBMISSION_TOPIC
  ) {
    // Handle new submission
    const timestamp = Date.parse(event.payload.created);

    logger.debug(`Started adding submission for ${event.payload.id}`);
    try {
      const patchObject = await LegacySubmissionIdService.addMMSubmission(
        event.payload.id,
        event.payload.challengeId,
        event.payload.memberId,
        event.payload.submissionPhaseId,
        event.payload.url,
        event.payload.type,
        timestamp,
        true
      );

      logger.debug(
        `Successfully processed MM message - Patched to the Submission API: id ${
          event.payload.id
        }, patch: ${JSON.stringify(patchObject)}`
      );
    } catch (error) {
      logger.error(
        `Failed to handle ${JSON.stringify(event)}: ${error.message}`
      );
      logger.error(error);
      throw error;
    }
  } else if (
    event.payload.resource === 'submission' &&
    event.payload.originalTopic === config.KAFKA_UPDATE_SUBMISSION_TOPIC &&
    event.payload.url
  ) {
    try {
      let legacySubmissionId = event.payload.legacySubmissionId;
      if (!legacySubmissionId) {
        // In case legacySubmissionId not present, try to get it from submission API
        const submission = await LegacySubmissionIdService.getSubmission(
          event.payload.id
        );

        if (!submission.legacySubmissionId) {
          throw new Error(
            `legacySubmissionId not found for submission: ${submission.id}`
          );
        }
        legacySubmissionId = submission.legacySubmissionId;
      }

      logger.debug(
        `Started updating URL for submission for ${legacySubmissionId}`
      );

      await LegacySubmissionIdService.updateUpload(
        event.payload.challengeId,
        event.payload.memberId,
        event.payload.submissionPhaseId,
        event.payload.url,
        event.payload.type,
        legacySubmissionId
      );

      logger.debug(
        `Successfully processed MM message - Submission url updated, legacy submission id : ${legacySubmissionId} with url ${
          event.payload.url
        }`
      );
    } catch (error) {
      logger.error(
        `Update URL - Failed to handle ${JSON.stringify(event)}: ${
          error.message
        }`
      );
      logger.error(error);
      throw error;
    }
  } else if (event.payload.resource === 'review') {
    // Handle provisional score

    // Validate required fields of submission
    try {
      validateSubmissionField(submission, 'memberId');
      validateSubmissionField(submission, 'submissionPhaseId');
      validateSubmissionField(submission, 'type');
      validateSubmissionField(submission, 'legacySubmissionId');

      await LegacySubmissionIdService.updateProvisionalScore(
        submission.challengeId,
        submission.memberId,
        submission.submissionPhaseId,
        submission.legacySubmissionId,
        submission.type,
        event.payload.score
      );

      logger.debug(
        'Successfully processed MM message - Provisional score updated'
      );
    } catch (error) {
      logger.error(
        `Failed to handle ${JSON.stringify(event)}: ${error.message}`
      );
      logger.error(error);
      throw error;
    }
  } else if (event.payload.resource === 'reviewSummation') {
    // Handle final score
    // Validate required fields of submission
    try {
      validateSubmissionField(submission, 'memberId');
      validateSubmissionField(submission, 'legacySubmissionId');

      await LegacySubmissionIdService.updateFinalScore(
        submission.challengeId,
        submission.memberId,
        submission.legacySubmissionId,
        event.payload.aggregateScore
      );
      logger.debug('Successfully processed MM message - Final score updated');
    } catch (error) {
      logger.error(
        `Failed to handle ${JSON.stringify(event)}: ${error.message}`
      );
      logger.error(error);
      throw error;
    }
  }
}

module.exports = {
  handle
};
