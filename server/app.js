import { CharacterAI } from './utils/authUtils.js'
import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'


dotenv.config();

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(bodyParser.json())

const JOBS_FILE = path.resolve('./jobs.json')
const jobs = new Map()

function saveJobs(){
    const obj = Object.fromEntries([...jobs.entries()].map(([k,v]) => [k, v]))
    try { fs.writeFileSync(JOBS_FILE, JSON.stringify(obj, null, 2)) } catch (e) { console.error('Failed to save jobs', e.message) }
}

function loadJobs(){
    try{
        if (!fs.existsSync(JOBS_FILE)) return
        const raw = fs.readFileSync(JOBS_FILE, 'utf8')
        const obj = JSON.parse(raw)
        for (const [k,v] of Object.entries(obj)) jobs.set(k, v)
    } catch(e){ console.error('Failed to load jobs', e.message) }
}

loadJobs()

for (const [id, job] of jobs.entries()){
    if (job.status === 'pending' || job.status === 'running'){
        if (job.email) {
            console.log(`Resuming job ${id} for ${job.email}`)
            const characterAI = new CharacterAI()
            const progress = (m) => {
                console.log(`job ${id}: ${m}`)
                job.message = m
                job.status = job.token ? 'done' : (m && m.toLowerCase().includes('failed')) ? 'error' : 'running'
                saveJobs()
            }
            ;(async () => {
                try{
                    const token = await characterAI.generateToken(job.email, progress)
                    job.token = token
                    job.status = 'done'
                    job.message = 'Token generated'
                    saveJobs()
                } catch (err){
                    job.status = 'error'
                    job.message = err.message || 'Generation failed'
                    saveJobs()
                }
            })()
        }
    }
}

app.post('/api/generate_token', (req, res) => {
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'email is required' })

    const id = randomUUID()
    const job = { id, status: 'pending', message: 'Queued', token: null, email }
    jobs.set(id, job)
    saveJobs()

    const characterAI = new CharacterAI()

    const progress = (m) => {
        console.log(`job ${id}: ${m}`)
        job.message = m
        job.status = job.token ? 'done' : (m && m.toLowerCase().includes('failed')) ? 'error' : 'running'
        saveJobs()
    }

    (async () => {
        try {
            const token = await characterAI.generateToken(email, progress)
            job.token = token
            job.status = 'done'
            job.message = 'Token generated'
            saveJobs()
        } catch (err) {
            job.status = 'error'
            job.message = err.message || 'Generation failed'
            saveJobs()
        }
    })()

    res.json({ jobId: id })
})

app.get('/api/job/:id', (req, res) => {
    const job = jobs.get(req.params.id)
    if (!job) return res.status(404).json({ error: 'job not found' })
    res.json({ id: job.id, status: job.status, message: job.message, token: job.token })
})

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})
