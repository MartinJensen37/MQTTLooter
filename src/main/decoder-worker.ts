import { parentPort } from 'node:worker_threads';
import { ProtobufDecoders, protoTypes } from './protobuf-decoders';
import { payloadBytes } from '../shared/payload';
import type { DecoderRequest } from '../shared/decoders';

const decoders = new ProtobufDecoders();
parentPort!.on(
  'message',
  ({ requestId, request }: { requestId: number; request: DecoderRequest }) => {
    try {
      let data: unknown = null;
      switch (request.action) {
        case 'configure':
          data = decoders.configure(request.decoders);
          break;
        case 'types':
          data = protoTypes(request.sources);
          break;
        case 'decode':
          data = decoders.decode(
            request.decoderId,
            payloadBytes(request.message, request.encoding),
          );
          break;
        case 'close':
          parentPort!.postMessage({ requestId, data: null });
          parentPort!.close();
          return;
      }
      parentPort!.postMessage({ requestId, data });
    } catch (error) {
      parentPort!.postMessage({ requestId, error: (error as Error).message });
    }
  },
);
