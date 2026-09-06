import { Router, type ErrorRequestHandler } from 'express';
import { AGRICULTURE_ROLES, AGRICULTURE_RULES, ANIMAL_SPECIES, FEDERAL_STATES } from '../../shared/agriculture';
import type { AgricultureRole } from '../../shared/agriculture';
import {
  completeProposal, createAnimal, createCustomer, createFarm, createProposal, decideReferral, getCustomer, getDocument,
  getFarm, getOverview, getPolicyDetail, getProposalDetail, makeOffer, printPolicy, reissuePolicy, submitProposal,
} from './domain';
import { AgricultureError, roleFromHeader } from './errors';
import { seedAgriculture } from './seed';
import { animalsQuerySchema, emptyBodySchema, farmsQuerySchema, identifierSchema, overviewQuerySchema, parseInput, printSchema } from './validation';

export function createAgricultureRouter(): Router {
  seedAgriculture();
  const router = Router();
  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.locals.agricultureRole = roleFromHeader(request.get('x-agriculture-role'));
    next();
  });
  router.param('id', (_request, _response, next, value) => {
    parseInput(identifierSchema, value);
    next();
  });

  router.get('/meta', (_request, response) => response.json({ roles: AGRICULTURE_ROLES, rules: AGRICULTURE_RULES, federalStates: FEDERAL_STATES, species: ANIMAL_SPECIES }));
  router.get('/overview', (request, response) => response.json(getOverview(parseInput(overviewQuerySchema, request.query).runId)));
  router.get('/customers', (_request, response) => response.json({ customers: getOverview().customers }));
  router.post('/customers', (request, response) => response.status(201).json({ customer: createCustomer(request.body, response.locals.agricultureRole as AgricultureRole) }));
  router.get('/farms', (request, response) => {
    const { customerId } = parseInput(farmsQuerySchema, request.query);
    if (customerId) getCustomer(customerId);
    response.json({ farms: getOverview().farms.filter(farm => !customerId || farm.customerId === customerId) });
  });
  router.post('/farms', (request, response) => response.status(201).json({ farm: createFarm(request.body, response.locals.agricultureRole as AgricultureRole) }));
  router.get('/animals', (request, response) => {
    const { farmId } = parseInput(animalsQuerySchema, request.query);
    if (farmId) getFarm(farmId);
    response.json({ animals: getOverview().animals.filter(animal => !farmId || animal.farmId === farmId) });
  });
  router.post('/animals', (request, response) => response.status(201).json({ animal: createAnimal(request.body, response.locals.agricultureRole as AgricultureRole) }));
  router.post('/proposals', (request, response) => response.status(201).json({ proposal: createProposal(request.body, response.locals.agricultureRole as AgricultureRole) }));
  router.get('/proposals/:id', (request, response) => response.json(getProposalDetail(request.params.id)));
  router.post('/proposals/:id/offer', (request, response) => {
    parseInput(emptyBodySchema, request.body ?? {});
    response.json(makeOffer(request.params.id, response.locals.agricultureRole as AgricultureRole));
  });
  router.post('/proposals/:id/submit', (request, response) => {
    parseInput(emptyBodySchema, request.body ?? {});
    response.json(submitProposal(request.params.id, response.locals.agricultureRole as AgricultureRole));
  });
  router.post('/referrals/:id/decision', (request, response) => response.json(decideReferral(request.params.id, request.body, response.locals.agricultureRole as AgricultureRole)));
  router.post('/proposals/:id/complete', (request, response) => {
    parseInput(emptyBodySchema, request.body ?? {});
    response.json(completeProposal(request.params.id, response.locals.agricultureRole as AgricultureRole));
  });
  router.get('/policies/:id', (request, response) => response.json(getPolicyDetail(request.params.id)));
  router.post('/policies/:id/reissue', (request, response) => response.json(reissuePolicy(request.params.id, request.body, response.locals.agricultureRole as AgricultureRole)));
  router.post('/policies/:id/print', (request, response) => {
    const { documentId } = parseInput(printSchema, request.body);
    response.json(printPolicy(request.params.id, documentId, response.locals.agricultureRole as AgricultureRole));
  });
  router.get('/documents/:id', (request, response) => response.json({ document: getDocument(request.params.id) }));
  router.get('/documents/:id/html', (request, response) => {
    const document = getDocument(request.params.id);
    response.set({ 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'", 'X-Content-Type-Options': 'nosniff' });
    response.type('html').send(document.html);
  });
  router.use((_request, response) => response.status(404).json({ error: 'Diese Seite der Tierversicherung wurde nicht gefunden.', code: 'NOT_FOUND' }));
  const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof AgricultureError) {
      response.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.error('Die Tierversicherung konnte die Anfrage nicht verarbeiten.', error);
    response.status(500).json({ error: 'Die Anfrage konnte nicht verarbeitet werden. Versuchen Sie es erneut.', code: 'SERVER_ERROR' });
  };
  router.use(handleError);
  return router;
}
