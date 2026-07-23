# Decisions — Promise Them Nothing Twice

<!-- Candidates: copy this file to submissions/<your-github-username>/promise-them-nothing-twice/DECISIONS.md and replace the prompts below. Keep it to one page. -->

## Conflict resolution
During the design process, there were different priorities between giving maximum resource allocation and maintaining fairness. I decided to reserve a portion of the available tokens instead of giving the full limit. I also maintained a 15-minute sliding window so requests are spread more evenly. This decreases unnecessary 429 Too Many Requests responses while still maintaining fairness for all customers, ensuring that no single customer can consume all the available resources.

I respected both perspectives and included both of their feedback. The CTO helped me design a system that is fair for all customers, while the Support Lead's feedback helped me optimize the system to reduce unnecessary 429 responses and improve overall efficiency.


## Technical design

I used a distributed rate limiter with Redis as the shared storage across all nodes, so every instance sees the same rate limit state. Requests are identified using the X-Customer-ID header. The rate limiter uses a token bucket for burst handling and maintains a 15-minute sliding window to smooth request distribution and maintain fairness.
I intentionally did not expose the full limit. Instead, I reserved a small portion of the available tokens. This helps reduce 429 Too Many Requests responses during the start of peak hours while still allowing capacity to be used when traffic is high.
The tradeoff is that a small amount of capacity is intentionally left unused, but it provides more consistent performance and fair resource allocation for all customers.

## Verification

I verified rate limiter using concurrent load testing with multiple customers and different traffic patterns. I tested normal traffic, burst traffic, concurrent requests, invalid customer IDs, and Redis failure scenarios. This proves that the rate limiter enforces limits correctly, maintains fairness, and works consistently across all nodes.

It does not prove that the system will handle every production scenario, such as very large traffic spikes, long Redis outages, or infrastructure failures. Those would require production-scale testing.


## If I had four more hours

If I had four more hours, I would add a monitoring system and dashboards. I would test the system under higher load and use real traffic spikes to understand how production traffic behaves. Using those results, I would tune the metrics and policies based on real usage patterns. I would also add more production-level policies and work on hidden edge cases that I was not able to think of during development.