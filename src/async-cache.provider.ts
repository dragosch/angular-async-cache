import { Injectable } from '@angular/core';
import { Observable, isObservable, from, of, concat, throwError } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import {
  AsyncCacheOptions,
  AsyncCacheOptionsInterface
} from './async-cache-options.provider';

export type GetPromiseFunction = () => Promise<any>;

function isPromiseLike(fn: any) {
  return fn && typeof fn.then === 'function' && typeof fn.catch === 'function';
}

function isObservableLike(fn: any) {
  return fn && isObservable(fn);
}

function anyToObservable(fn: any) {
  if (isObservableLike(fn)) {
    return fn;
  } else if (isPromiseLike(fn)) {
    return from(fn);
  } else {
    return of(fn);
  }
}

@Injectable()
export class AsyncCache {
  constructor(private defaults: AsyncCacheOptions) {}

  wrap<T = any>(
    value: Observable<T> | GetPromiseFunction,
    cacheKey: string,
    userOptions: AsyncCacheOptionsInterface = {}
  ): Observable<T> {
    let getAsyncValue: Observable<T>;
    const options: AsyncCacheOptionsInterface = Object.assign(
      {},
      this.defaults,
      userOptions
    );

    if (isObservableLike(value)) {
      getAsyncValue = value as Observable<T>;
    } else if (typeof value === 'function') {
      getAsyncValue = of(value).pipe(
        switchMap(promiseFactory => {
          const promise: Promise<T> = promiseFactory();
          if (!isPromiseLike(promise)) {
            return throwError(
              "The function you passed to the async cache didn't return a promise"
            );
          }
          return from(promise);
        })
      );
    } else {
      throw new Error(
        'Value can only be an observable or a function that returns a promise'
      );
    }

    return anyToObservable(options.driver.has(cacheKey)).pipe(
      switchMap(existsInCache => {
        const cacheAndReturnAsyncValue = () =>
          getAsyncValue.pipe(
            switchMap(asyncValue => {
              return anyToObservable(
                options.driver.set(cacheKey, asyncValue)
              ).pipe(map(() => asyncValue));
            })
          );

        if (existsInCache && !options.bypassCache) {
          const getCachedValue: Observable<T> = anyToObservable(
            options.driver.get(cacheKey)
          );

          if (options.fromCacheAndReplay) {
            return concat(getCachedValue, cacheAndReturnAsyncValue());
          } else {
            return getCachedValue;
          }
        } else {
          return cacheAndReturnAsyncValue();
        }
      })
    );
  }
}
