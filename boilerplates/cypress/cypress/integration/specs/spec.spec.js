/// <reference types="Cypress" />

describe('suite', () => {
  before(() => {
    cy.visit('https://example.cypress.io/commands/assertions')
  })

  // this test is mapped to test case in qTest with id 11096456
  // https://MY.qtestnet.com/p/12345/portal/project#tab=testdesign&object=1&id=11096456
  it('test @qTest[11096456]', () => {
    cy.wait(500)
  })
})
