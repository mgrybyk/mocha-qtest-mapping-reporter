# mocha-qtest-mapping-reporter
mocha qTest reporter that uses tag _@qTest[testCaseId]_ to map mocha to test case id

## We assume that

* you want to have test suites with single test run per test case.
* you want to map mocha test(s) to test case in qTest
* you want to prepare Test Suite manually before tests execution

**qTest**

Test Suite  [testSuiteId]

  Test Run -> Test Case [testCaseId]

  Test Run -> Test Case [testCaseId]

  ...
  
**Mocha Test**

describe('Component')

  describe('Feature')

    it('test or test step @qTest[testCaseId]')
    
## How it works

Before test execution is started reporter gets Test Runs of Test Suite.

Having Test Runs reporter can build mapping like: { testCaseId: testRunId } 

Reporter uploads mocha test (it('')) result after step is completed (failed or passed).

## Configuration

example config file
```
{
  "host": "...", // your qTest host
  "bearerToken": "********-****-****-****-************", *// can be found in resources*
  "projectId": "12345", *// your project id*
  "statePassed": "PASS", *// can be found in automation settings -> integration*
  "stateFailed": "FAIL", *// can be found in automation settings -> integration*
  "enableLogs": false *// disables console logging. Default value: true.*
}
```
using like this
`--reporter-options configFile=config/qTestReporter.json"`

## Environment variables
QTEST_SUITE_ID - testSuiteId. **Required**

QTEST_BUILD_URL - url to your build system or any other url. Optional

## FAQ

Q: What is testCaseId, testRunId, testSuiteId

A: this is object id that can be found in URL. It is **not** what you see in UI like (TC-XXX, TR-XXX, TS-XXX)


## TODOs / known issues
1. attachments are not supported at the moment, will be implemented soon;
2. qTest API allows us to create Test Suites automatically. It will be implemented if someone needs it;