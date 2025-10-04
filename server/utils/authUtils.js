import fetch from 'node-fetch'

class CharacterAI{
    constructor(){
        this.token = null;
        this.edgeRollout = null;
        this.userInfo = null;
    }

    async getEdgeRollout(progress){
        try{
            if (progress) progress('Getting edge rollout configuration...')
            const response = await fetch('https://character.ai/', {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            })

            const cookies = response.headers.get('set-cookie')
            if (cookies){
                const edgeMatch = cookies.match(/edge_rollout=(\d+)/)
                this.edgeRollout = edgeMatch ? edgeMatch[1] : null
                if (progress) progress(`Edge rollout: ${this.edgeRollout || 'none'}`)
            }

            return this.edgeRollout
        } catch (err){
            if (progress) progress(`Failed to get edge rollout: ${err.message}`)
            return null
        }
    }

    async generateToken(email, progress){
        try{
            if (progress) progress(`Starting authentication for: ${email}`)
            await this.getEdgeRollout(progress)
            if (progress) progress('Sending login request...')

            const loginResponse = await fetch('https://character.ai/api/trpc/auth.login?batch=1', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                body: JSON.stringify({
                    '0': { json: { email } }
                })
            })

            if (!loginResponse.ok){
                throw new Error(`Login request failed: ${loginResponse.status}`)
            }

            const loginData = await loginResponse.json()
            const pollingUuid = loginData[0]?.result?.data?.json

            if (!pollingUuid){
                throw new Error('Invalid email or failed to get polling UUID')
            }

            if (progress) progress(`Login request sent! Polling UUID: ${pollingUuid}`)
            if (progress) progress('Please check your email and click the magic link!')
            return await this.pollForLogin(pollingUuid, email, progress)

        } catch (err){
            if (progress) progress(`Token generation failed: ${err.message}`)
            throw err
        }
    }

    async pollForLogin(pollingUuid, email, progress){
        if (progress) progress('Waiting for magic link click...')
        const maxAttempts = 60
        let attempts = 0

        while (attempts < maxAttempts){
            try{
                await this.sleep(2000)
                attempts++

                const headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://character.ai/',
                    'Origin': 'https://character.ai'
                }
                if (this.edgeRollout) headers['Cookie'] = `edge_rollout=${this.edgeRollout}`

                const pollResponse = await fetch(`https://character.ai/login/polling/?uuid=${pollingUuid}`, {
                    method: 'GET',
                    headers
                })

                if (pollResponse.ok){
                    const pollData = await pollResponse.json()
                    if (pollData.result === 'done' && pollData.value){
                        if (progress) progress('Magic link clicked! Processing authentication...')
                        return await this.exchangeForToken(pollData.value, email, progress)
                    }
                }

                if (attempts % 10 === 0 && progress){
                    progress(`Still waiting... (${attempts}/${maxAttempts} attempts)`)
                }
            } catch (err){
                if (progress) progress(`Polling attempt ${attempts}/${maxAttempts} failed, retrying...`)
            }
        }

        throw new Error('Timeout: Magic link was not clicked within 2 minutes')
    }

    async exchangeForToken(magicLinkValue, email, progress){
        try{
            if (progress) progress('Exchanging magic link for tokens...')
            const url = new URL(magicLinkValue)
            const oobCode = url.searchParams.get('oobCode')

            if (!oobCode) throw new Error('Failed to extract OOB code from magic link')

            if (progress) progress('Exchanging OOB code with Firebase...')
            const firebaseResponse = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=AIzaSyAbLy_s6hJqVNr2ZN0UHHiCbJX1X8smTws', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, oobCode })
            })

            if (!firebaseResponse.ok){
                throw new Error(`Firebase auth failed: ${firebaseResponse.status}`)
            }

            const firebaseData = await firebaseResponse.json()
            const idToken = firebaseData.idToken
            if (!idToken) throw new Error('Failed to get Firebase ID token')

            if (progress) progress('Getting Character.AI auth token...')
            const caiAuthResponse = await fetch('https://plus.character.ai/dj-rest-auth/google_idp/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_token: idToken })
            })

            if (!caiAuthResponse.ok){
                throw new Error(`Character.AI auth failed: ${caiAuthResponse.status}`)
            }

            const caiAuthData = await caiAuthResponse.json()
            const authToken = caiAuthData.key
            if (!authToken) throw new Error('Failed to get Character.AI auth token')

            this.token = authToken
            if (progress) progress('Authentication successful!')
            return authToken
        } catch (err){
            if (progress) progress(`Token exchange failed: ${err.message}`)
            throw err
        }
    }

    sleep(ms){
        return new Promise(r => setTimeout(r, ms))
    }
}

export { CharacterAI }