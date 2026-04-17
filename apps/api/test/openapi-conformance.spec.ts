import 'reflect-metadata';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as YAML from 'yaml';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';

const METHOD_MAP: Record<number, string> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.OPTIONS]: 'options',
  [RequestMethod.HEAD]: 'head',
  [RequestMethod.ALL]: 'all',
};

function toOpenApiPath(p: string): string {
  return (
    '/' +
    p
      .split('/')
      .filter(Boolean)
      .map((seg) => (seg.startsWith(':') ? `{${seg.slice(1)}}` : seg))
      .join('/')
  );
}

function joinPath(controllerPath: string, routePath: string): string {
  const cp = controllerPath.replace(/^\/+|\/+$/g, '');
  const rp = routePath.replace(/^\/+|\/+$/g, '');
  const joined = [cp, rp].filter(Boolean).join('/');
  return '/' + joined;
}

describe('OpenAPI conformance', () => {
  let registered: Set<string>;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
      })
      .compile();

    const app = moduleRef.createNestApplication<NestExpressApplication>();
    // Don't call listen — we only need the container to be ready.
    const discovery = app.get(DiscoveryService);
    const scanner = app.get(MetadataScanner);

    registered = new Set<string>();
    const controllers = discovery.getControllers();
    for (const wrapper of controllers) {
      const instance = wrapper.instance as object | null;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance);
      const controllerPath =
        Reflect.getMetadata(PATH_METADATA, wrapper.metatype as object) ?? '/';
      const paths: string[] = Array.isArray(controllerPath)
        ? controllerPath
        : [controllerPath];

      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const routeRaw = Reflect.getMetadata(PATH_METADATA, handler) as
          | string
          | string[]
          | undefined;
        const methodCode = Reflect.getMetadata(METHOD_METADATA, handler) as
          | number
          | undefined;
        if (routeRaw === undefined || methodCode === undefined) continue;
        const routePaths = Array.isArray(routeRaw) ? routeRaw : [routeRaw];
        for (const cp of paths) {
          for (const rp of routePaths) {
            const full = joinPath(cp, rp);
            const verb = METHOD_MAP[methodCode] ?? 'get';
            registered.add(`${verb} ${toOpenApiPath(full)}`);
          }
        }
      }
    }

    await app.close();
  });

  it('every path+method in openapi.yaml is backed by a Nest route', () => {
    const yamlPath = resolve(__dirname, '..', '..', '..', 'openapi.yaml');
    const doc = YAML.parse(readFileSync(yamlPath, 'utf8')) as {
      paths: Record<string, Record<string, unknown>>;
    };

    const missing: string[] = [];
    for (const [p, ops] of Object.entries(doc.paths)) {
      for (const method of Object.keys(ops)) {
        if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
        const key = `${method} ${p}`;
        if (!registered.has(key)) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });
});
