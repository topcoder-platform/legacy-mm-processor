/**
 * The default configuration.
 */
module.exports = {
  LOG_LEVEL: process.env.LOG_LEVEL || 'debug',

  KAFKA_CONCURRENCY: process.env.KAFKA_CONCURRENCY ? Number(process.env.KAFKA_CONCURRENCY) : 1,
  // The client group ID for committing and fetching offsets.
  // All clients sharing the same group ID belong to the same group.
  KAFKA_GROUP_ID: process.env.KAFKA_GROUP_ID || 'tc-mm-submission-legacy-processor',

  // The comma delimited list of initial brokers list
  KAFKA_URL: process.env.KAFKA_URL || 'ssl://kafka-host:9093',

  // The client cert, can be (1) the path to the cert file, or (2) the cert content
  KAFKA_CLIENT_CERT: process.env.KAFKA_CLIENT_CERT || './docker/kafka/kafka-ssl/client.crt',

  // The client cert key, can be (1) the path to the cert key file, or (2) the cert key content
  KAFKA_CLIENT_CERT_KEY: process.env.KAFKA_CLIENT_CERT_KEY || './docker/kafka/kafka-ssl/client.key',

  // The topic from which the app consumes events
  KAFKA_NEW_SUBMISSION_TOPIC: process.env.KAFKA_NEW_SUBMISSION_TOPIC || 'submission.notification.create',

  // topic for update event
  KAFKA_UPDATE_SUBMISSION_TOPIC: process.env.KAFKA_UPDATE_SUBMISSION_TOPIC || 'submission.notification.update',

  // The event originator
  KAFKA_NEW_SUBMISSION_ORIGINATOR: process.env.KAFKA_NEW_SUBMISSION_ORIGINATOR || 'submission-api',

  // The Submission API URL
  SUBMISSION_API_URL: process.env.SUBMISSION_API_URL || 'http://mock-api-host:3000',

  // The Submission API timeout
  SUBMISSION_TIMEOUT: process.env.SUBMISSION_TIMEOUT || '10000',

  // payload.types
  PAYLOAD_TYPES: process.env.PAYLOAD_TYPES || 'bcf2b43b-20df-44d1-afd3-7fc9798dfcae',

  // The Informix Database Name
  DB_NAME: process.env.DB_NAME || 'tcs_catalog@informixoltp_tcp',

  // The CommonOLTP Database Name
  DB_ID_NAME: process.env.DB_ID_NAME || 'common_oltp@informixoltp_tcp',

  // CommonOLTP Database Name
  DB_ID_NAME: process.env.DB_ID_NAME || 'common_oltp@informixoltp_tcp',

  // The Informix Database Username
  DB_USERNAME: process.env.DB_USERNAME || 'informix',

  // The Informix Database Password
  DB_PASSWORD: process.env.DB_PASSWORD || '1nf0rm1x',

  // The Informix Upload Table Sequence Name
  ID_SEQ_UPLOAD: process.env.ID_SEQ_UPLOAD || 'upload_id_seq',

  // The Informix Submission Table Sequence Name
  ID_SEQ_SUBMISSION: process.env.ID_SEQ_SUBMISSION || 'submission_id_seq',

  // The Informix long_component_state Table Sequence Name
  ID_SEQ_COMPONENT_STATE: process.env.ID_SEQ_COMPONENT_STATE || 'COMPONENT_STATE_SEQ',

  AUTH0_URL: process.env.AUTH0_URL || 'https://topcoder-dev.auth0.com/oauth/token', // Auth0 credentials for Submission Service

  AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE || 'https://m2m.topcoder-dev.com/',

  TOKEN_CACHE_TIME: process.env.TOKEN_CACHE_TIME || '86400000',

  AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID,

  AUTH0_CLIENT_SECRET: process.env.AUTH0_CLIENT_SECRET,

  AUTH0_PROXY_SERVER_URL: process.env.AUTH0_PROXY_SERVER_URL,

  CHALLENGE_INFO_API: process.env.CHALLENGE_INFO_API || 'http://mock-api-host:3000/challenges?filter=id={cid}', // {cid} gets replaced with challenge id

  CHALLENGE_SUBTRACK: process.env.CHALLENGE_SUBTRACK || 'MARATHON_MATCH, DEVELOP_MARATHON_MATCH'
}
