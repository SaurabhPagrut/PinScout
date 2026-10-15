<script setup>
import { ref } from 'vue'

const url = ref('')
const pincode = ref('')
const loading = ref(false)
const result = ref(null)
const error = ref('')

async function check() {
  error.value = ''
  result.value = null
  loading.value = true
  try {
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url: url.value, pincode: pincode.value})
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Request failed')
    result.value = data
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main>
    <h1>PinScout</h1>
    <p>Check whether a product can be delivered to a pincode.</p>

    <label>Flipkart product URL</label>
    <input v-model="url" placeholder="https://www.flipkart.com/..." />

    <label>Your pincode</label>
    <input v-model="pincode" maxlength="6" inputmode="numeric" placeholder="444001" />

    <button :disabled="loading" @click="check">
      {{ loading ? 'Checking…' : 'Check availability' }}
    </button>

    <p v-if="error" class="error">{{ error }}</p>

    <section v-if="result">
      <h2>{{ result.product?.title || 'Product' }}</h2>
      <p v-if="result.availability.serviceable">✅ Deliverable to {{ result.availability.pincode }}</p>
      <p v-else>❌ Not deliverable to {{ result.availability.pincode }}</p>
      <p v-if="result.availability.sla_text">{{ result.availability.sla_text }}</p>
      <p v-if="result.availability.availability">Stock signal: {{ result.availability.availability }}</p>
    </section>
  </main>
</template>

<style>
body { font-family: system-ui, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; }
input { display:block; width:100%; box-sizing:border-box; padding:12px; margin:8px 0 18px; }
button { padding:12px 18px; cursor:pointer; }
.error { color:#b00020; }
section { margin-top:24px; padding:18px; border:1px solid #ddd; border-radius:10px; }
</style>
