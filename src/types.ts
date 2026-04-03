import type { BcsType } from "./bcs-type.js";

export type Encoding = "base58" | "base64" | "hex";

export type InferBcsType<T extends BcsType<any>> = T extends BcsType<
	infer U,
	any
>
	? U
	: never;
export type InferBcsInput<T extends BcsType<any, any>> = T extends BcsType<
	any,
	infer U
>
	? U
	: never;

export type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type EnumOutputShape<
	T extends Record<string, unknown>,
	Keys extends string = Extract<keyof T, string>,
	Values = T[keyof T] extends infer Type
		? Type extends BcsType<infer U>
			? U
			: never
		: never,
> = 0 extends Values
	? EnumOutputShapeWithKeys<T, never>
	: 0n extends Values
		? EnumOutputShapeWithKeys<T, never>
		: "" extends Values
			? EnumOutputShapeWithKeys<T, never>
			: false extends Values
				? EnumOutputShapeWithKeys<T, never>
				: EnumOutputShapeWithKeys<T, Keys>;

export type EnumOutputShapeWithKeys<
	T extends Record<string, unknown>,
	Keys extends string,
> = {
	[K in keyof T]: Exclude<Keys, K> extends infer Empty extends string
		? Simplify<
				{ [K2 in K]: T[K] } & { [K3 in Empty]?: never } & {
					$kind: K;
				}
			>
		: never;
}[keyof T];

export type EnumInputShape<T extends Record<string, unknown>> = {
	[K in keyof T]: { [K2 in K]: T[K] };
}[keyof T];

export type JoinString<T, Sep extends string> = T extends readonly [
	infer F extends string,
	...infer R extends string[],
]
	? [] extends R
		? F
		: `${F}${Sep}${JoinString<R, Sep>}`
	: "";
