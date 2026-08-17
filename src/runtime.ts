import { DeliveryJob } from './domain/delivery/delivery-job.js';

const job = DeliveryJob.create('runtime-smoke-test');
job.transitionTo('REQUESTED');

console.log(JSON.stringify({
  runtime: 'suftrip-v2',
  node: process.version,
  deliveryJob: job.snapshot(),
}));
