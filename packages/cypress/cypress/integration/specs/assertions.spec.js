/// <reference types="Cypress" />

context('context', () => {
  beforeEach(() => {
    cy.visit('https://example.cypress.io/commands/assertions')
  })

  describe('suite', () => {
    it('test ', () => {
      cy.wait(1000)
    })
  })
})
