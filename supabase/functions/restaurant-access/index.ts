import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const reply = (status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:cors});
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');if(!token)return reply(401,{error:'authentication_required'});
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const caller=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:{user},error}=await caller.auth.getUser(token);if(error||!user)return reply(401,{error:'invalid_session'});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:account}=await admin.from('accounts').select('is_active,restaurants!inner(id,name,status,logo_path)').eq('auth_user_id',user.id).maybeSingle();
  if(!account)return reply(404,{error:'restaurant_account_not_found'});
  const restaurant=(account.restaurants as any);
  return reply(200,{active:account.is_active&&restaurant.status==='active',restaurant_id:restaurant.id,restaurant_name:restaurant.name,logo_path:restaurant.logo_path});
});
