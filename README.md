# mocha-qtest-mapping-reporter
Mocha qTest reporter.  
Map your test cases to automated tests with tag _@qTest[testCaseId]_

## We assume that

* you want to have test suites with single test run per test case.
* you want to map mocha test(s) to test case in qTest
* ideally mapping is 1 to 1 to avoid execution result overwriting

**qTest Structure**
```
Test Suite  [testSuiteId]
  Test Run -> Test Case [testCaseId]
  Test Run -> Test Case [testCaseId]
  ...
```

**Mocha Test**
```
describe('Component')
  describe('Feature')
    it('test or test step @qTest[testCaseId]')
```

## How it works

Before test execution is started reporter either gets Test Runs of Test Suite or creates empty Test Suite.

Having Test Runs reporter can build mapping like: { testCaseId: testRunId }  
Test Run is created automatically if Test Run for a Test Case is missing in Test Suite

Assuming test has string like @qTest[123456] in name, reporter uploads mocha test result once step is completed (failed or passed).

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
you can pass options one by one or pass path to json like this:  
`--reporter-options configFile=config/qTestReporter.json`

## Environment variables

You can either use existing Test Suite or create new one

### Using Existing Test Suite *(useful for combined test executions, ex: manual + automated)*

`QTEST_SUITE_ID` - testSuiteId. **Required**

### Creating Test Suite
`QTEST_PARENT_TYPE` - one of *root / release / test-cycle / test-suite*. **Required**  
`QTEST_PARENT_ID` - parent id. Set to 0 if parent is root. **Required**  
`QTEST_SUITE_NAME` - Test Suite name. **Required**

### Common

`QTEST_BUILD_URL` - url to your build system or any other url. *Optional*
`QTEST_CREATE_TEST_RUNS` - specify if test runs have to be created in qTest or just update existing ones. *Optional*

## FAQ

**Q**: What is testCaseId, testRunId, testSuiteId  
**A**: this is object id that can be found in URL. It is **not** what you see in UI like (TC-XXX, TR-XXX, TS-XXX)

**Q**: What QTEST_SUITE_ID value should I pass if I want it to be created automatically?  
**A**: Don't pass any value.  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;You may specify either QTEST_SUITE_ID or combination of QTEST_PARENT_TYPE, QTEST_PARENT_ID, QTEST_SUITE_NAME

## TODOs / known issues
1. TODO: attachments support;
2. Any questions/suggestions are welcomed!
