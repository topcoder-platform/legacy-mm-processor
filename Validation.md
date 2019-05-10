# Topcoder - Legacy MM Processor Application - Verification
------------
> NOTE: ALL COMMANDS BELOW EXECUTE UNDER ```<legacy-mm-procecssor>``` directory

## Run Kafka and Create Topic

Build Kafka image:
```bash
docker-compose build kafka
```

Run Kafka server:
```bash
docker-compose up -d kafka
docker exec -ti kafka bash -c "kafka-topics.sh --create --zookeeper localhost:2181 --replication-factor 1 --partitions 1 --topic submission.notification.create"
docker exec -ti kafka bash -c "kafka-topics.sh --create --zookeeper localhost:2181 --replication-factor 1 --partitions 1 --topic submission.notification.update"
```

## Run Informix and Insert Test Data
Make sure you're running a clean database (you can take down and remove iif_innovator_c container and then up it again)
```bash
export DB_SERVER_NAME=informix

docker kill iif_innovator_c
docker rm iif_innovator_c

docker-compose up -d tc-informix

docker logs iif_innovator_c
# When you see log like following then informix is started:
# starting rest listener on port 27018
# starting mongo listener on port 27017
```

**Then insert test data (which will be used by Unit Tests step and Verification step)**:
```bash
docker cp test/sql/test.sql iif_innovator_c:/
docker exec -ti iif_innovator_c bash -c "source /home/informix/ifx_informixoltp_tcp.env && dbaccess - /test.sql"
```

## Build Application Docker Image
We only need to do this once
```bash
export DB_SERVER_NAME=informix
docker-compose build lsp-app
```

## Install App dependencies
```bash
export DB_SERVER_NAME=informix
rm -rf node_modules && docker-compose run lsp-app-install
```

**Note**, if the ***legacy-processor-module*** is changed locally (e.g. during local dev and not pushed to git yet), then you need to delete it from *node_modules* and copy the local changed one to *node_modules*:

```bash
rm -rf ./node_modules/legacy-processor-module
cp -rf <path/to/legacy-processor-module> ./node_modules
# e.g cp -rf ../legacy-processor-module ./node_modules
```

## Standard Code Style

- Check code style `npm run lint`
- Check code style with option to fix the errors `npm run lint:fix`

## Run Unit Tests
- Stop `legacy-sub-processor` application if it was running: `docker stop lsp-app`
- Make sure kafka container running with topic created and informix container running with test data inserted
- Run unit tests:
```bash
docker-compose run lsp-app-test
```

## Verify with Test Data
Deploy first:
```bash
export DB_SERVER_NAME=informix
docker-compose up lsp-app
```

- Run `docker exec -ti lsp-app bash -c "npm run produce-test-event different-topic"` and verify that the app doesn't consume this message (no log)
- Run `docker exec -ti lsp-app bash -c "npm run produce-test-event null-message"` and verify that the app skips this message (log: `Skipped null or empty event`)
- Run `docker exec -ti lsp-app bash -c "npm run produce-test-event empty-message"` and verify that the app skips this message (log: `Skipped null or empty event`)
- Run `docker exec -ti lsp-app bash -c "npm run produce-test-event invalid-json"` and verify that the app skips this message (log: `Skipped non well-formed JSON message: ...`)
- Run `docker exec -ti lsp-app bash -c "npm run produce-test-event empty-json"` and verify that the app skips this message (log: `Skipped invalid event, reasons: "topic" is required ...`)
- Run `docker exec -ti lsp-app bash -c "npm run produce-test-event invalid-payload"` and verify that the app skips this message (log: `Skipped invalid event, reasons: "timestamp" must be...`)
- Run `docker exec -ti lsp-app bash -c "npm run produce-test-event wrong-topic"` and verify that the app skips this message (log: `Skipped event from topic wrong-topic`)
- Run `docker exec -ti lsp-app bash -c "npm run produce-test-event wrong-originator"` and verify that the app skips this message (log: `Skipped event from topic wrong-originator`)

- Run `docker exec -ti lsp-app bash -c "npm run produce-test-event mm-submission"` and verify that the app has log like `Successfully processed MM message - Patched to the Submission API: id 118, patch: {"legacySubmissionId":60000}`.
- Run `docker exec -ti lsp-app bash -c "npm run produce-test-event mm-submission2"` and verify that the app has log like `Successfully processed MM message - Patched to the Submission API: id 119, patch: {"legacySubmissionId":60001}`.
- Run `docker exec -ti lsp-app bash -c "npm run produce-test-event mm-provisional-score"` and verify that the app has log like `Successfully processed MM message - Provisional score updated`.
- Run `docker exec -ti lsp-app bash -c "npm run produce-test-event mm-provisional-score2"` and verify that the app has log like `Successfully processed MM message - Provisional score updated`.
- Run `docker exec -ti lsp-app bash -c "npm run produce-test-event mm-final-score"` and verify that the app has log like `Successfully processed MM message - final score updated`.
- Run `docker exec -ti lsp-app bash -c "npm run produce-test-event mm-final-score2"` and verify that the app has log like `Successfully processed MM message - final score updated`.

After above steps, we have created submissions for 2 users, then you can check table `informixoltp:long_comp_result` to verify the users' score (`point_total`/`system_point_total`) and `placed`.

## Verify Database
Open your database explorer (**DBeaver** application, for instance). Connect to database informixoltp
Check table: `round_registration`, `long_component_state`, `long_submission` and `long_comp_result`

## Cleanup
After verification, run `docker-compose down` to take down and remove containers.
