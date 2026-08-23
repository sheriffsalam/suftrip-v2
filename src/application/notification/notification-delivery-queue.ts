import type { Notification } from '../../domain/notification/notification.js';
export type ClaimedNotification=Readonly<{notification:Notification;attemptId:string;attempts:number}>;
export interface NotificationDeliveryQueue {
 claim(workerId:string,limit:number,leaseMs:number,maxAttempts:number,now?:Date):Promise<ClaimedNotification[]>;
 markSent(workerId:string,attemptId:string,notification:Notification,providerReference:string|null,now?:Date):Promise<boolean>;
 markFailed(workerId:string,attemptId:string,notification:Notification,now?:Date):Promise<boolean>;
}
