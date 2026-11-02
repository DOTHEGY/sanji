// Interpret only this exact provider compatibility signal; never return provider text.
export function metaCompatibility(data:any){const error=data?.error;return error?.code===100&&typeof error?.message==='string'&&/^\s*(?:\(#100\)\s*)?tried accessing nonexisting field\s*\(user_id\)\s+on node type\b/i.test(error.message.slice(0,300))?'unsupported_user_id_field':null;}
