import { Router, type ErrorRequestHandler, type RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import { createStandardDraft, ROLES } from '../../shared/insurance';
import type { Customer, Policy, Quote, Role } from '../../shared/insurance';
import { db } from '../store';
import {
  amendPolicy, approveQuote, attachDocument, collections, createCustomer, createPolicy,
  getCustomer, getPolicy, getQuote, getSchedule, InsuranceError, issuePolicy, requestQuote, requireRole, updatePolicy,
} from './domain';
import { amendmentSchema, approvalSchema, customerSchema, documentSchema, emptyBodySchema, issueSchema, parseDraft, patchSchema } from './validation';
import { seedInsurance } from './seed';

const roleFor = (value: unknown): Role => {
  if (value === undefined || value === '') return 'Broker';
  if (value !== 'Broker' && value !== 'Senior underwriter') throw new InsuranceError(400, 'INVALID_ROLE', 'Use Broker or Senior underwriter as the acting role.');
  return value;
};

const querySchema = z.object({
  status: z.enum(['Draft', 'Referred', 'Quoted', 'Approved', 'Issued']).optional(),
  source: z.enum(['manual', 'run']).optional(),
  runId: z.string().max(120).optional(),
}).strip();

export function createInsuranceRouter(): Router {
  seedInsurance();
  const router = Router();
  const setRole: RequestHandler = (request, response, next) => {
    response.locals.role = roleFor(request.get('x-folio-role'));
    next();
  };
  router.use(setRole);

  router.get('/meta', (_request, response) => {
    response.json({ product: 'Meridian Commercial Property', productVersion: 3, roles: ROLES,
      floodReferralThreshold: 500_000, currency: 'EUR', issuingMarket: 'DE', countries: ['DE', 'IT'],
      demo: true });
  });

  router.get('/templates/standard', (_request, response) => response.json({ template: createStandardDraft() }));

  router.get('/customers', (_request, response) => {
    const customers = db.read<Customer>(collections.customers).sort((a, b) => a.name.localeCompare(b.name));
    response.json({ customers });
  });

  router.post('/customers', (request, response) => {
    requireRole(response.locals.role as Role, 'Broker');
    const customer = createCustomer(customerSchema.parse(request.body));
    response.status(201).json({ customer });
  });

  router.get('/policies', (request, response) => {
    const query = querySchema.parse(request.query);
    const policies = db.read<Policy>(collections.policies)
      .filter(policy => (!query.status || policy.status === query.status) && (!query.source || policy.source === query.source) && (!query.runId || policy.runId === query.runId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    response.json({ policies, customers: db.read<Customer>(collections.customers) });
  });

  router.post('/policies', (request, response) => {
    const policy = createPolicy(parseDraft(request.body), response.locals.role as Role);
    response.status(201).json({ policy });
  });

  router.get('/policies/:id', (request, response) => {
    const policy = getPolicy(request.params.id);
    response.json({ policy, customer: getCustomer(policy.customerId), quote: policy.quoteId ? getQuote(policy.quoteId) : null });
  });

  router.patch('/policies/:id', (request, response) => {
    const policy = updatePolicy(request.params.id, patchSchema.parse(request.body), response.locals.role as Role);
    response.json({ policy });
  });

  router.post('/policies/:id/quote', (request, response) => {
    emptyBodySchema.parse(request.body ?? {});
    response.json(requestQuote(request.params.id, response.locals.role as Role));
  });

  router.get('/quotes/:id', (request, response) => response.json({ quote: getQuote(request.params.id) }));

  router.get('/referrals', (_request, response) => {
    const policies = db.read<Policy>(collections.policies).filter(policy => policy.status === 'Referred')
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const quotes = policies.flatMap(policy => {
      const quote = policy.quoteId ? db.find<Quote>(collections.quotes, policy.quoteId) : undefined;
      return quote && quote.status === 'Referred' && quote.policyId === policy.id && quote.policyRevision === policy.revision ? [quote] : [];
    });
    response.json({ policies, quotes, customers: db.read<Customer>(collections.customers) });
  });

  router.post('/policies/:id/documents', (request, response) => {
    const input = documentSchema.parse(request.body);
    response.status(201).json(attachDocument(request.params.id, input, response.locals.role as Role));
  });

  router.post('/quotes/:id/approve', (request, response) => {
    const input = approvalSchema.parse(request.body);
    response.json(approveQuote(request.params.id, input.policyId, input.notes, response.locals.role as Role));
  });

  router.post('/policies/:id/issue', (request, response) => {
    const input = issueSchema.parse(request.body);
    response.json(issuePolicy(request.params.id, input.quoteId, response.locals.role as Role));
  });

  router.get('/policies/:id/schedule', (request, response) => response.json({ schedule: getSchedule(request.params.id) }));

  router.post('/policies/:id/amendments', (request, response) => {
    const input = amendmentSchema.parse(request.body);
    response.json(amendPolicy(request.params.id, input.effectiveDate, input.reason, input.changes, response.locals.role as Role));
  });

  const errors: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ error: error.issues.slice(0, 4).map(issue => `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`).join('; '), code: 'VALIDATION_ERROR' });
      return;
    }
    if (error instanceof InsuranceError) {
      response.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
