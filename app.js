 // --- 1. SUPABASE CONFIGURATION ---
    const SUPABASE_URL = 'https://wkedqgkucbrbsxbnrlgj.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_rJwyfnfLrrxlP0L3ftuubQ_5_Gf2jxh';
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let currentUser = null;
    let currentProfile = null;
    let hasFatalError = false; 
    let isCheckingSession = false;
    let activeNodeId = null;

    // --- SECURITY HELPER ---
    function esc(str) {
      if (str === null || str === undefined) return '';
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }

    // --- 2. INITIALIZATION & STATE ROUTING ---
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (hasFatalError) return; 
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') checkSession();
      else if (event === 'SIGNED_OUT') renderState('login');
    });

    async function checkSession() {
      if (hasFatalError || isCheckingSession) return;
      isCheckingSession = true;
      
      showLoader();
      try {
        const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
        if (sessionError) throw sessionError;
        
        if (!session) { renderState('login'); return; }
        currentUser = session.user;
        
        let { data: profile, error: fetchError } = await supabaseClient.from('profiles').select('*').eq('id', currentUser.id).single();
        if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;
        
        if (!profile) {
          const { data: newProfile, error: insertError } = await supabaseClient.from('profiles').insert([
            { id: currentUser.id, email: currentUser.email, status: 'pending', role: 'pending' }
          ]).select().single();
          if (insertError) throw insertError;
          profile = newProfile;
        }

        currentProfile = profile;
        if (!profile) throw new Error("Profile creation failed silently.");

        // Routing Logic
        if (!profile.pledge_version) {
          document.getElementById('pledge-email').textContent = profile.email;
          renderState('pledge');
        } else if (profile.status === 'approved') {
          document.getElementById('welcome-msg').textContent = `USR:${(profile.full_name || profile.email || 'UNKNOWN').toUpperCase()}`;
          loadDashboard(); renderState('dashboard');
        } else {
          throw new Error(`ACCESS DENIED: Unknown status '${profile.status}'.`);
        }
      } catch (err) {
        hasFatalError = true;
        console.error("Session Error:", err);
        
        ['state-login', 'state-pledge', 'state-dashboard', 'state-node', 'state-directory'].forEach(id => {
          document.getElementById(id).classList.add('hidden');
        });
        
        const loader = document.getElementById('loader');
        loader.classList.remove('hidden');
        loader.innerHTML = `
          <div style="color: var(--accent-red); padding: 20px; border: 1px solid var(--accent-red); border-radius: 8px; background: rgba(255,0,0,0.1); margin-bottom: 20px; text-align: left;">
            <strong style="font-family: 'Space Grotesk', sans-serif;">SYSTEM ERROR DETECTED:</strong><br><br>
            <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.85rem;">${err.message || JSON.stringify(err)}</span>
          </div>
          <button class="secondary" onclick="supabaseClient.auth.signOut().then(() => window.location.reload())" style="width: auto;">Clear Session & Restart</button>
        `;
      } finally {
        isCheckingSession = false; 
      }
    }

    function renderState(stateId) {
      ['loader', 'state-login', 'state-pledge', 'state-dashboard', 'state-node', 'state-directory'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
      });
      const target = stateId === 'loader' ? 'loader' : `state-${stateId}`;
      document.getElementById(target).classList.remove('hidden');
    }

    function showLoader() { renderState('loader'); }

 // --- 3. AUTHENTICATION FLOW ---
let authEmail = "";

// Step 1: Request the 8-Digit Code (Now a 'submit' event)
document.getElementById('email-form').addEventListener('submit', async (e) => {
  e.preventDefault(); // Stops the page from refreshing when you hit Enter
  
  const emailInput = document.getElementById('email').value;
  const btn = document.getElementById('request-code-btn');
  const msg = document.getElementById('login-msg');
  
  if (!emailInput) {
    msg.innerText = "[ ERROR: EMAIL REQUIRED ]";
    return;
  }

  authEmail = emailInput;
  btn.innerText = "TRANSMITTING..."; 
  btn.disabled = true; 
  msg.innerText = "";
  
  const { error } = await supabaseClient.auth.signInWithOtp({ 
    email: authEmail
  });

  btn.innerText = "Request Access Code"; 
  btn.disabled = false;

  if (error) {
    msg.innerText = `[ DB ERROR: ${error.message} ]`;
  } else {
    document.getElementById('email-form').classList.add('hidden');
    document.getElementById('otp-form').classList.remove('hidden');
    document.getElementById('otp-code').focus();
  }
});

// Step 2: Verify the 8-Digit Code
document.getElementById('otp-form').addEventListener('submit', async (e) => {
  e.preventDefault(); 
  const code = document.getElementById('otp-code').value;
  const btn = document.getElementById('verify-btn');
  const msg = document.getElementById('login-msg');

  if (!code || code.length !== 8) {
    msg.innerText = "[ ERROR: 8-DIGIT CODE REQUIRED ]";
    return;
  }

  btn.innerText = "VERIFYING..."; 
  btn.disabled = true; 
  msg.innerText = "";

  const { data, error } = await supabaseClient.auth.verifyOtp({
    email: authEmail,
    token: code,
    type: 'email'
  });

  btn.innerText = "Verify & Connect"; 
  btn.disabled = false;

  if (error) {
    msg.innerText = `[ AUTH FAILED: ${error.message} ]`;
  } 
  // Global onAuthStateChange handles routing upon success
});

// Step 3: Cancel and return to email input
document.getElementById('back-to-email-btn').addEventListener('click', () => {
  document.getElementById('otp-form').classList.add('hidden');
  document.getElementById('email-form').classList.remove('hidden');
  document.getElementById('login-msg').innerText = "";
  document.getElementById('otp-code').value = "";
});
    // --- 4. ONBOARDING (PLEDGE) LOGIC ---
    document.getElementById('pledge-form').addEventListener('submit', handlePledgeSubmit);
    document.getElementById('request-form').addEventListener('submit', submitAttachmentRequest);

    async function handlePledgeSubmit(e) {
      e.preventDefault();
      const btn = document.getElementById('sign-btn');
      const fullName = document.getElementById('fullName').value;

      btn.innerText = "EXECUTING..."; btn.disabled = true;
      
      const { error: profileError } = await supabaseClient.from('profiles').update({
        full_name: fullName, 
        role: 'stakeholder', 
        status: 'approved', 
        pledge_version: 'unified_v1'
      }).eq('id', currentUser.id);
      
      if (profileError) {
        alert("Execution failed: " + profileError.message);
        btn.innerText = "Sign & Execute Contract"; btn.disabled = false;
        return;
      }
      
      checkSession(); 
    }

    // --- 5. DASHBOARD LOGIC ---
    async function loadDashboard() {
      const container = document.getElementById('committee-list');
      const { data, error } = await supabaseClient.from('committees').select('*, profiles!profile_id(full_name)').eq('status', 'Active');
      
      if (error) { 
        container.innerHTML = `<p style="color: var(--accent-red); font-family: 'JetBrains Mono', monospace;">DB ERROR: ${error.message}</p>`; 
        console.error("Dashboard DB Error:", error); 
        return; 
      }
      if (!data || data.length === 0) { container.innerHTML = `<p style="color:var(--text-muted); font-family:'JetBrains Mono', monospace;">[0] ACTIVE NODES FOUND.</p>`; return; }

      container.innerHTML = data.map(comm => `
        <div class="committee-card" style="cursor: pointer;" onclick="openNode('${comm.id}')">
          <div style="display:flex; justify-content:space-between; align-items: flex-start; margin-bottom: 1rem;">
            <h4 style="margin:0; color:#fff; font-size:1.1rem;">${esc(comm.title)}</h4>
            <div style="display:flex; gap:8px;">
              <span class="badge purple">${esc(comm.focus_area)}</span>
              <span class="badge active">SYS.ACTIVE</span>
            </div>
          </div>
          <p style="font-family:'JetBrains Mono', monospace; font-size:0.75rem; color:var(--text-muted); margin-bottom:0.5rem; text-transform:uppercase;">
            LEAD: ${esc(comm.profiles?.full_name) || 'TBD'}
          </p>
          <p style="font-size:0.9rem; line-height:1.6; color:var(--text-primary);">${esc(comm.abstract) || 'No parameters provided.'}</p>
        </div>
      `).join('');
    }

    async function openNode(committeeId) {
      renderState('loader');
      activeNodeId = committeeId;
      
      try {
        // 1. Fetch Node Details
        const { data: node, error: nodeError } = await supabaseClient.from('committees').select('*').eq('id', committeeId).single();
        if (nodeError) throw nodeError;
        
        document.getElementById('node-title').textContent = node.title;
        document.getElementById('node-focus').textContent = node.focus_area;
        document.getElementById('node-abstract').textContent = node.abstract;

        // 2, 3, & 4. Fetch Status, Roster, and Resources in parallel
        const [
          { data: myRequest },
          { data: roster, error: rosterError },
          { data: resources, error: resourceError }
        ] = await Promise.all([
          supabaseClient.from('committee_requests').select('status').eq('committee_id', committeeId).eq('profile_id', currentUser.id).maybeSingle(),
          supabaseClient.from('committee_requests').select('profile_id, profiles!profile_id(full_name, role)').eq('committee_id', committeeId).eq('status', 'approved'),
          supabaseClient.from('committee_resources').select('*').eq('committee_id', committeeId)
        ]);

        // Render Action Container (Uses myRequest)
        const actionContainer = document.getElementById('node-action-container');
        if (myRequest) {
          if (myRequest.status === 'approved') {
            actionContainer.innerHTML = `
              <div style="display:flex; gap: 10px; align-items: center;">
                <span class="badge" style="background: rgba(255,255,255,0.1); color: #fff; border-color: rgba(255,255,255,0.2);">SYS.JOINED</span>
                <button onclick="leaveNode('${committeeId}')" style="padding: 4px 8px; font-size: 0.65rem; width: auto; background: rgba(255,0,60,0.1); color: var(--accent-red); border-color: var(--accent-red);">LEAVE</button>
              </div>
            `;
          } else if (myRequest.status === 'pending') {
            actionContainer.innerHTML = '<span class="badge" style="background: rgba(234, 179, 8, 0.1); color: #eab308; border-color: #ca8a04;">REQUEST PENDING</span>';
          } else { actionContainer.innerHTML = ''; }
        } else {
          actionContainer.innerHTML = `<button style="padding: 6px 12px; font-size: 0.75rem; width: auto;" onclick="showRequestModal('${committeeId}')">REQUEST ACCESS</button>`; 
        }

        // Render Roster
        const rosterContainer = document.getElementById('node-roster');
        if (rosterError) {
          rosterContainer.innerHTML = `<p style="color: var(--accent-red); font-size: 0.85rem; font-family: monospace;">[ DB ERROR: ${rosterError.message} ]</p>`;
        } else if (roster && roster.length > 0) {
          
          // Sort the roster: Lead at the top, then alphabetically by name
          roster.sort((a, b) => {
            if (a.profile_id === node.profile_id) return -1;
            if (b.profile_id === node.profile_id) return 1;
            return (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || '');
          });

          rosterContainer.innerHTML = roster.map(r => {
            if (!r.profiles) return '';
            
            // 1. Check if this person is the current lead
            const isCurrentLead = r.profile_id === node.profile_id;
            const isAdmin = currentProfile.role === 'admin';
            
            // 2. Render either the Node Lead badge or the Make Lead button
            let leadIndicator = '';
            if (isCurrentLead) {
              leadIndicator = `<span class="badge active" style="margin-left: 12px; border-color: var(--accent-cyan); color: var(--accent-cyan);">NODE LEAD</span>`;
            } else if (isAdmin) {
              leadIndicator = `<button onclick="assignLead('${committeeId}', '${r.profile_id}')" style="padding: 2px 8px; font-size: 0.65rem; width: auto; margin-left: 12px; background: rgba(112, 0, 255, 0.1); border-color: var(--accent-purple); color: #b07cff;">MAKE LEAD</button>`;
            }

            return `
            <div style="padding: 10px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center;"><span style="font-family: 'Inter', sans-serif;">${esc(r.profiles.full_name)}</span>${leadIndicator}</div>
              <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">[ ${esc(r.profiles.role)} ]</span>
            </div>`;
          }).join('');
        } else { rosterContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; font-family: monospace;">[ ROSTER EMPTY ]</p>'; }
       
        // Render Resources
        const isChairOrAdmin = currentProfile.role === 'admin' || currentProfile.id === node.profile_id;
        const isApprovedMember = myRequest && myRequest.status === 'approved';
        const hasResourceAccess = isChairOrAdmin || isApprovedMember;

        const resourceContainer = document.getElementById('node-resources');
        
        if (!hasResourceAccess) {
          // Block non-members with the new messaging
          resourceContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; font-family: monospace;">[ RESOURCES HIDDEN UNTIL NODE JOINED ]</p>';
        } else if (resourceError) {
          // Handle legitimate DB errors for members
          resourceContainer.innerHTML = `<p style="color: var(--accent-red); font-size: 0.85rem; font-family: monospace;">[ DB ERROR: ${resourceError.message} ]</p>`;
        } else if (resources && resources.length > 0) {
          // Render resources for authorized members
          resourceContainer.innerHTML = resources.map(res => {
            const hrefAttr = res.resource_url === '#' ? 'javascript:void(0)' : res.resource_url;
            const targetAttr = res.resource_url === '#' ? '' : 'target="_blank"';
            const cursorStyle = res.resource_url === '#' ? 'cursor: default; opacity: 0.6;' : 'cursor: pointer;';
            return `
            <div style="padding: 12px 10px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); margin-bottom: 8px; display: flex; align-items: center; gap: 12px;">
              <span class="badge" style="background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.2); color: var(--text-muted); min-width: 50px; text-align: center;">${esc(res.resource_type)}</span>
              <a href="${esc(hrefAttr)}" ${targetAttr} style="color: var(--accent-cyan); text-decoration: none; font-family: 'Space Grotesk', sans-serif; font-size: 0.95rem; text-transform: uppercase; font-weight: 600; ${cursorStyle}">> ${esc(res.title)}</a>
            </div>`;
          }).join('');
        } else { 

          resourceContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; font-family: monospace;">[ SANDBOX EMPTY ]</p>'; 
        }
        
        // 5. Fetch Pending Requests (Admin or Chair Only)
        const adminPanel = document.getElementById('chair-admin-panel');
        
        if (isChairOrAdmin) {
          adminPanel.classList.remove('hidden');
          const { data: pending, error: pendingError } = await supabaseClient
            .from('committee_requests')
            .select('id, message, profiles!profile_id(full_name, role)')
            .eq('committee_id', committeeId)
            .eq('status', 'pending');

          const pendingContainer = document.getElementById('node-pending-requests');
          if (pending && pending.length > 0) {
            pendingContainer.innerHTML = pending.map(p => `
              <div style="padding: 12px; background: rgba(0,0,0,0.4); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                  <span style="font-family: 'Inter', sans-serif; font-weight: 600; color: #fff;">${esc(p.profiles.full_name)} <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: var(--text-muted);">[${esc(p.profiles.role).toUpperCase()}]</span></span>
                  <div style="display: flex; gap: 8px;">
                    <button onclick="resolveRequest('${p.id}', '${committeeId}', 'approved')" style="padding: 2px 8px; font-size: 0.7rem; width: auto; color: var(--accent-cyan); border-color: var(--accent-cyan);">APPROVE</button>
                    <button onclick="resolveRequest('${p.id}', '${committeeId}', 'rejected')" style="padding: 2px 8px; font-size: 0.7rem; width: auto; color: var(--accent-red); border-color: var(--accent-red);">REJECT</button>
                  </div>
                </div>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0; font-style: italic;">"${esc(p.message) || 'No transmission provided.'}"</p>
              </div>
            `).join('');
          } else {
            pendingContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; font-family: monospace;">[ 0 PENDING REQUESTS ]</p>';
          }
        } else {
          adminPanel.classList.add('hidden');
        }
        
        renderState('node');
        
      } catch (err) {
        alert("Failed to load node parameters: " + err.message);
        renderState('dashboard');
      }
    }

    let pendingRequestCommitteeId = null;

    function showRequestModal(committeeId) {
      pendingRequestCommitteeId = committeeId;
      document.getElementById('modal-node-name').textContent = document.getElementById('node-title').textContent;
      document.getElementById('request-message').value = '';
      document.getElementById('request-modal').classList.remove('hidden');
    }

    function closeRequestModal() {
      pendingRequestCommitteeId = null;
      document.getElementById('request-modal').classList.add('hidden');
    }

    async function submitAttachmentRequest(e) {
      e.preventDefault();
      const btn = document.getElementById('modal-submit-btn');
      const message = document.getElementById('request-message').value;

      btn.innerText = "TRANSMITTING..."; btn.disabled = true;

      const payload = {
        profile_id: currentUser.id,
        committee_id: pendingRequestCommitteeId,
        request_type: 'join_existing',
        status: 'pending',
        message: message 
      };

      const { error } = await supabaseClient.from('committee_requests').insert([payload]);

      if (error) {
        btn.innerText = "Transmit Request"; btn.disabled = false; // Only re-enable if there's an error
        alert("Access request failed: " + error.message);
      } else {
        const cid = pendingRequestCommitteeId;
        closeRequestModal();
        btn.innerText = "Transmit Request"; btn.disabled = false; // Reset silently while hidden
        openNode(cid); 
      }
    }

    async function assignLead(committeeId, profileId) {
      if (!confirm("Designate this user as the Node Lead?")) return;
      
      const { data, error } = await supabaseClient
        .from('committees')
        .update({ profile_id: profileId })
        .eq('id', committeeId)
        .select(); // <--- Forces the DB to return the modified row

      if (error) {
        alert("Failed to assign lead: " + error.message);
      } else if (!data || data.length === 0) {
        alert("Silent Database Rejection: The database blocked the update. Check RLS policies.");
      } else {
        // Refresh the node view to show the new lead
        openNode(committeeId);
      }
    }

    async function resolveRequest(requestId, committeeId, newStatus) {
      if (!confirm(`Confirm decision to mark request as ${newStatus.toUpperCase()}?`)) return;
      
      try {
        // 1. Update the request status
        const { data: requestData, error: reqError } = await supabaseClient
          .from('committee_requests')
          .update({ status: newStatus, resolved_by: currentUser.id })
          .eq('id', requestId)
          .select('profile_id')
          .single();
          
        if (reqError) throw reqError;

        // 2. If approved, upgrade the user's global profile status to grant app access
        if (newStatus === 'approved' && requestData) {
          const { error: profError } = await supabaseClient
            .from('profiles')
            .update({ status: 'approved' })
            .eq('id', requestData.profile_id);
            
          if (profError) throw profError;
        }

        openNode(committeeId); 
        
      } catch (err) {
        alert("Execution failed: " + err.message);
      }
    }

    async function leaveNode(committeeId) {
      if (!confirm("Confirm intent to leave this node. This will immediately revoke your workspace access.")) return;
      
      const { error } = await supabaseClient
        .from('committee_requests')
        .delete()
        .eq('committee_id', committeeId)
        .eq('profile_id', currentUser.id);

      if (error) {
        alert("Leave action failed: " + error.message);
      } else {
        openNode(committeeId); 
      }
    }

   async function openDirectory() {
      console.log("[NAV] Registry Button Clicked");
      
      // Force the UI to show the Directory state explicitly
      ['loader', 'state-login', 'state-pledge', 'state-dashboard', 'state-node', 'state-directory'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });
      document.getElementById('state-directory').classList.remove('hidden');

      // Fire the loader
      await loadDirectory();
    }

    async function loadDirectory() {
      const container = document.getElementById('registry-grid');
      
      try {
        container.innerHTML = '<div class="loader" style="grid-column: 1 / -1;">[ QUERYING.REGISTRY... ]</div>';
        
        const { data, error } = await supabaseClient
          .from('profiles')
          .select('*')
          .eq('status', 'approved')
          .order('full_name', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
          container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; font-family: monospace; grid-column: 1 / -1;">[ REGISTRY EMPTY ]</p>';
          return;
        }

        container.innerHTML = data.map(p => {
          const displayName = p.full_name || p.email || 'UNKNOWN';
          const displayRole = p.role || 'STAKEHOLDER';
          const displayEmail = p.email || 'NO_EMAIL';
          
          return `
          <div style="padding: 1.5rem; background: rgba(0,0,0,0.4); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); transition: border-color 0.2s ease;" onmouseover="this.style.borderColor='var(--accent-purple)'" onmouseout="this.style.borderColor='var(--border-glass)'">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
              <span style="font-family: 'Space Grotesk', sans-serif; font-weight: 700; color: #fff; font-size: 1.1rem; text-transform: uppercase;">${esc(displayName)}</span>
              <span class="badge" style="background: rgba(112, 0, 255, 0.1); color: #b07cff; border-color: var(--accent-purple); text-transform: uppercase;">${esc(displayRole)}</span>
            </div>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.8rem;">
              <a href="mailto:${esc(displayEmail)}" style="color: var(--accent-cyan); text-decoration: none;">> ${esc(displayEmail)}</a>
            </div>
          </div>`;
        }).join('');

      } catch (err) {
        console.error("Registry Load Error:", err);
        container.innerHTML = `<p style="color: var(--accent-red); font-family: 'JetBrains Mono', monospace; grid-column: 1 / -1;">[ DB ERROR: ${err.message} ]</p>`;
      }
    }

    async function submitResource(e) {
      e.preventDefault();
      const btn = document.getElementById('resource-submit-btn');
      btn.innerText = "TRANSMITTING..."; btn.disabled = true;

      const payload = {
        committee_id: activeNodeId,
        title: document.getElementById('resource-title').value,
        resource_type: document.getElementById('resource-type').value,
        resource_url: document.getElementById('resource-url').value
      };

      const { error } = await supabaseClient.from('committee_resources').insert([payload]);

      btn.innerText = "TRANSMIT TO SANDBOX"; btn.disabled = false;

      if (error) {
        alert("Transmission failed: " + error.message);
      } else {
        document.getElementById('add-resource-form').reset();
        openNode(activeNodeId); // Instantly reload the workspace to show the new link
      }
    }
