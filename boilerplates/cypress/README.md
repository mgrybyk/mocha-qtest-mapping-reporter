# Cypress boilerplate with mocha-qtest-mapping-reporter

Bolierplate with mocha-qtest-mapping-reporter and mocha-junit-reporter working together.


1. Configure reporter in `cypress/qTestReporter.json`
```
  "host": "MY.qtestnet.com",
  "bearerToken": "12345678-abcd-abcd-abcd-123456789abc",
  "projectId": "12345",
  ...
```

2. Change qTest test-case ID in `spec.spec.js`
3. See package.json scripts for examples with existing / new suite
4. Run like `QTEST_SUITE_ID=1234567 npm run test:suite:existing`
5. Results should be published to qTest!
