import { DeliveryJob } from './domain/delivery/delivery-job.js';

const job = DeliveryJob.create({
  id: 'runtime-smoke-test',
  requesterId: 'runtime-user',
  pickup: {
    address: 'Ikeja, Lagos',
    latitude: 6.6018,
    longitude: 3.3515,
  },
  dropoff: {
    address: 'Victoria Island, Lagos',
    latitude: 6.4281,
    longitude: 3.4219,
  },
  deliveryType: 'PARCEL',
});

console.log({
  node: process.version,
  deliveryJob: job.snapshot(),
});