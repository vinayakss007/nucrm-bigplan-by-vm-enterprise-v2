 CREATE OR REPLACE FUNCTION public.calculate_churn_risk(p_contact_id uuid)                                                                                         
  RETURNS numeric                                                                                                                                                  
  LANGUAGE plpgsql                                                                                                                                                 
 AS $function$                                                                                                                                                     
 BEGIN                                                                                                                                                             
   RETURN 0.1;                                                                                                                                                     
 END;                                                                                                                                                              
 $function$;
 
 CREATE OR REPLACE FUNCTION public.calculate_deal_win_probability(p_deal_id uuid)                                                                                  
  RETURNS numeric                                                                                                                                                  
  LANGUAGE plpgsql                                                                                                                                                 
 AS $function$                                                                                                                                                     
 DECLARE v_prob numeric;                                                                                                                                           
 BEGIN                                                                                                                                                             
   SELECT COALESCE(                                                                                                                                                
     CASE                                                                                                                                                          
       WHEN stage.probability IS NOT NULL THEN stage.probability                                                                                                   
       WHEN d.value > 0 AND d.value < 10000 THEN 0.3                                                                                                               
       WHEN d.value >= 10000 AND d.value < 50000 THEN 0.5                                                                                                          
       WHEN d.value >= 50000 THEN 0.7                                                                                                                              
       ELSE 0.1                                                                                                                                                    
     END, 0.1)                                                                                                                                                     
   INTO v_prob                                                                                                                                                     
   FROM deals d                                                                                                                                                    
   LEFT JOIN deal_stages stage ON stage.id = d.stage_id                                                                                                            
   WHERE d.id = p_deal_id;                                                                                                                                         
   RETURN COALESCE(v_prob, 0.1);                                                                                                                                   
 END;                                                                                                                                                              
 $function$;
 
 CREATE OR REPLACE FUNCTION public.calculate_sequence_step_date(p_sequence_id uuid, p_step_number integer)                                                         
  RETURNS timestamp with time zone                                                                                                                                 
  LANGUAGE plpgsql                                                                                                                                                 
 AS $function$                                                                                                                                                     
 BEGIN                                                                                                                                                             
   RETURN NOW() + interval '1 day';                                                                                                                                
 END;                                                                                                                                                              
 $function$;
 
 CREATE OR REPLACE FUNCTION public.end_impersonation(p_session_id uuid)                                                                                            
  RETURNS void                                                                                                                                                     
  LANGUAGE plpgsql                                                                                                                                                 
 AS $function$                                                                                                                                                     
 BEGIN                                                                                                                                                             
   DELETE FROM sessions WHERE id = p_session_id AND is_impersonation = true;                                                                                       
 END;                                                                                                                                                              
 $function$;
 
 CREATE OR REPLACE FUNCTION public.enroll_contact_in_sequence(p_sequence_id uuid, p_contact_id uuid)                                                               
  RETURNS uuid                                                                                                                                                     
  LANGUAGE plpgsql                                                                                                                                                 
 AS $function$                                                                                                                                                     
 BEGIN                                                                                                                                                             
   INSERT INTO sequence_enrollments (id, sequence_id, contact_id, status, enrolled_at)                                                                             
   VALUES (gen_random_uuid(), p_sequence_id, p_contact_id, 'active', NOW());                                                                                       
   RETURN gen_random_uuid();                                                                                                                                       
 END;                                                                                                                                                              
 $function$;
 
 CREATE OR REPLACE FUNCTION public.execute_saved_report(p_report_id uuid, p_user_id uuid, p_source text, p_filters jsonb DEFAULT '{}'::jsonb)                      
  RETURNS jsonb                                                                                                                                                    
  LANGUAGE plpgsql                                                                                                                                                 
 AS $function$                                                                                                                                                     
 DECLARE v_result jsonb;                                                                                                                                           
 BEGIN                                                                                                                                                             
   v_result := jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'page', 1);                                                                                     
   RETURN v_result;                                                                                                                                                
 END;                                                                                                                                                              
 $function$;
 
 CREATE OR REPLACE FUNCTION public.execute_workflow(p_workflow_id uuid, p_trigger_type text, p_trigger_entity_id uuid)                                             
  RETURNS uuid                                                                                                                                                     
  LANGUAGE plpgsql                                                                                                                                                 
 AS $function$                                                                                                                                                     
 DECLARE                                                                                                                                                           
   v_execution_id uuid;                                                                                                                                            
   v_workflow_id uuid;                                                                                                                                             
   v_tenant_id uuid;                                                                                                                                               
 BEGIN                                                                                                                                                             
   SELECT id, tenant_id INTO v_workflow_id, v_tenant_id FROM workflows WHERE id = p_workflow_id AND deleted_at IS NULL;                                            
                                                                                                                                                                   
   IF v_workflow_id IS NULL THEN                                                                                                                                   
     RETURN NULL;                                                                                                                                                  
   END IF;                                                                                                                                                         
                                                                                                                                                                   
   IF p_trigger_type = 'contact' THEN                                                                                                                              
     INSERT INTO workflow_executions (id, workflow_id, tenant_id, status, contact_id, input_data, started_at)                                                      
     VALUES (gen_random_uuid(), p_workflow_id, v_tenant_id, 'running', p_trigger_entity_id, jsonb_build_object('trigger_type', p_trigger_type), NOW())             
     RETURNING id INTO v_execution_id;                                                                                                                             
   ELSIF p_trigger_type = 'lead' THEN                                                                                                                              
     INSERT INTO workflow_executions (id, workflow_id, tenant_id, status, lead_id, input_data, started_at)                                                         
     VALUES (gen_random_uuid(), p_workflow_id, v_tenant_id, 'running', p_trigger_entity_id, jsonb_build_object('trigger_type', p_trigger_type), NOW())             
     RETURNING id INTO v_execution_id;                                                                                                                             
   ELSE                                                                                                                                                            
     INSERT INTO workflow_executions (id, workflow_id, tenant_id, status, input_data, started_at)                                                                  
     VALUES (gen_random_uuid(), p_workflow_id, v_tenant_id, 'running', jsonb_build_object('trigger_type', p_trigger_type, 'entity_id', p_trigger_entity_id), NOW())
     RETURNING id INTO v_execution_id;                                                                                                                             
   END IF;                                                                                                                                                         
                                                                                                                                                                   
   RETURN v_execution_id;                                                                                                                                          
 END;                                                                                                                                                              
 $function$;
 
 CREATE OR REPLACE FUNCTION public.find_duplicate_contacts(p_tenant_id uuid)                                                                                       
  RETURNS TABLE(contact_id uuid, duplicate_id uuid, field text, value text)                                                                                        
  LANGUAGE plpgsql                                                                                                                                                 
 AS $function$                                                                                                                                                     
 BEGIN                                                                                                                                                             
   RETURN QUERY SELECT c1.id, c2.id, 'email'::text, COALESCE(c1.email, '')                                                                                         
   FROM contacts c1 JOIN contacts c2 ON c1.email = c2.email AND c1.id < c2.id                                                                                      
   WHERE c1.tenant_id = p_tenant_id AND c1.email IS NOT NULL AND c1.deleted_at IS NULL AND c2.deleted_at IS NULL;                                                  
 END;                                                                                                                                                              
 $function$;
 
 CREATE OR REPLACE FUNCTION public.merge_contacts(p_primary_id uuid, p_secondary_id uuid)                                                                          
  RETURNS void                                                                                                                                                     
  LANGUAGE plpgsql                                                                                                                                                 
 AS $function$                                                                                                                                                     
 BEGIN                                                                                                                                                             
   UPDATE deals SET contact_id = p_primary_id WHERE contact_id = p_secondary_id;                                                                                   
   UPDATE activities SET contact_id = p_primary_id WHERE contact_id = p_secondary_id;                                                                              
   UPDATE notes SET contact_id = p_primary_id WHERE contact_id = p_secondary_id;                                                                                   
   UPDATE tasks SET contact_id = p_primary_id WHERE contact_id = p_secondary_id;                                                                                   
   DELETE FROM contacts WHERE id = p_secondary_id;                                                                                                                 
 END;                                                                                                                                                              
 $function$;
 
 CREATE OR REPLACE FUNCTION public.platform_stats()                                                                                                                
  RETURNS jsonb                                                                                                                                                    
  LANGUAGE plpgsql                                                                                                                                                 
  STABLE                                                                                                                                                           
 AS $function$                                                                                                                                                     
 DECLARE                                                                                                                                                           
   result jsonb;                                                                                                                                                   
 BEGIN                                                                                                                                                             
   SELECT jsonb_build_object(                                                                                                                                      
     'mrr', COALESCE((                                                                                                                                             
       SELECT SUM(p.price_monthly::numeric)                                                                                                                        
       FROM tenants t                                                                                                                                              
       JOIN plans p ON p.id = t.plan_id                                                                                                                            
       WHERE t.status = 'active' AND t.deleted_at IS NULL                                                                                                          
     ), 0),                                                                                                                                                        
     'active_tenants', COALESCE((                                                                                                                                  
       SELECT COUNT(*)::int                                                                                                                                        
       FROM tenants                                                                                                                                                
       WHERE status = 'active' AND deleted_at IS NULL                                                                                                              
     ), 0),                                                                                                                                                        
     'trialing', COALESCE((                                                                                                                                        
       SELECT COUNT(*)::int                                                                                                                                        
       FROM tenants                                                                                                                                                
       WHERE status = 'trialing' AND deleted_at IS NULL                                                                                                            
     ), 0),                                                                                                                                                        
     'total_users', COALESCE((                                                                                                                                     
       SELECT COUNT(*)::int                                                                                                                                        
       FROM users                                                                                                                                                  
       WHERE deleted_at IS NULL                                                                                                                                    
     ), 0),                                                                                                                                                        
     'unresolved_errors', COALESCE((                                                                                                                               
       SELECT COUNT(*)::int                                                                                                                                        
       FROM error_logs                                                                                                                                             
       WHERE resolved = false                                                                                                                                      
     ), 0)                                                                                                                                                         
   ) INTO result;                                                                                                                                                  
   RETURN result;                                                                                                                                                  
 END;                                                                                                                                                              
 $function$;
 
 CREATE OR REPLACE FUNCTION public.purge_trash()                                                                                                                   
  RETURNS integer                                                                                                                                                  
  LANGUAGE plpgsql                                                                                                                                                 
 AS $function$                                                                                                                                                     
 DECLARE v_count int;                                                                                                                                              
 BEGIN                                                                                                                                                             
   v_count := 0;                                                                                                                                                   
   DELETE FROM contacts WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - interval '30 days';                                                                  
   v_count := v_count + 1;                                                                                                                                         
   DELETE FROM deals WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - interval '30 days';                                                                     
   v_count := v_count + 1;                                                                                                                                         
   DELETE FROM companies WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - interval '30 days';                                                                 
   v_count := v_count + 1;                                                                                                                                         
   DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - interval '30 days';                                                                     
   v_count := v_count + 1;                                                                                                                                         
   RETURN v_count;                                                                                                                                                 
 END;                                                                                                                                                              
 $function$;
 
 CREATE OR REPLACE FUNCTION public.register_feature(p_name text, p_description text, p_version text)                                                               
  RETURNS void                                                                                                                                                     
  LANGUAGE plpgsql                                                                                                                                                 
 AS $function$                                                                                                                                                     
 BEGIN                                                                                                                                                             
   INSERT INTO feature_flags (name, description, version, enabled)                                                                                                 
   VALUES (p_name, p_description, p_version, false)                                                                                                                
   ON CONFLICT (name) DO NOTHING;                                                                                                                                  
 END;                                                                                                                                                              
 $function$;
 
 CREATE OR REPLACE FUNCTION public.snapshot_tenant_usage()                                                                                                         
  RETURNS integer                                                                                                                                                  
  LANGUAGE plpgsql                                                                                                                                                 
 AS $function$                                                                                                                                                     
 BEGIN                                                                                                                                                             
   INSERT INTO usage_snapshots (tenant_id, user_count, contact_count, deal_count, storage_bytes, period_start, period_end)                                         
   SELECT t.id,                                                                                                                                                    
     (SELECT COUNT(*) FROM users WHERE tenant_id = t.id AND deleted_at IS NULL),                                                                                   
     (SELECT COUNT(*) FROM contacts WHERE tenant_id = t.id AND deleted_at IS NULL),                                                                                
     (SELECT COUNT(*) FROM deals WHERE tenant_id = t.id AND deleted_at IS NULL),                                                                                   
     0::bigint,                                                                                                                                                    
     date_trunc('month', NOW()),                                                                                                                                   
     date_trunc('month', NOW()) + interval '1 month'                                                                                                               
   FROM tenants t WHERE t.deleted_at IS NULL                                                                                                                       
   ON CONFLICT (tenant_id, period_start) DO NOTHING;                                                                                                               
   RETURN 1;                                                                                                                                                       
 END;                                                                                                                                                              
 $function$;
 
 CREATE OR REPLACE FUNCTION public.start_impersonation(p_target_user_id uuid)                                                                                      
  RETURNS uuid                                                                                                                                                     
  LANGUAGE plpgsql                                                                                                                                                 
 AS $function$                                                                                                                                                     
 DECLARE v_session_id uuid;                                                                                                                                        
 BEGIN                                                                                                                                                             
   v_session_id := gen_random_uuid();                                                                                                                              
   INSERT INTO sessions (id, user_id, token_hash, expires_at, is_impersonation, original_user_id)                                                                  
   VALUES (v_session_id, p_target_user_id, 'impersonation', NOW() + interval '1 hour', true, p_target_user_id);                                                    
   RETURN v_session_id;                                                                                                                                            
 END;                                                                                                                                                              
 $function$;
 
 CREATE OR REPLACE FUNCTION public.update_contact_lifecycle(p_contact_id uuid, p_stage text, p_user_id uuid, p_reason text DEFAULT NULL::text)                     
  RETURNS void                                                                                                                                                     
  LANGUAGE plpgsql                                                                                                                                                 
 AS $function$                                                                                                                                                     
 BEGIN                                                                                                                                                             
   UPDATE contacts SET lifecycle_stage = p_stage, updated_at = NOW() WHERE id = p_contact_id;                                                                      
   INSERT INTO contact_lifecycle_events (contact_id, from_stage, to_stage, changed_by, reason, changed_at)                                                         
   VALUES (p_contact_id, (SELECT lifecycle_stage FROM contacts WHERE id = p_contact_id), p_stage, p_user_id, p_reason, NOW());                                     
 END;                                                                                                                                                              
 $function$;
 

