# Database inventory and migration audit

This project stores most newsroom, public content, community, and advertising data in the application schema defined by the runtime bootstrap logic in `server.js` and the MariaDB/MySQL migration files in `migrations/`.

## Core production tables

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Authentication and staff accounts | `id`, `username`, `password`, `role`, `is_active` |
| `districts` | Administrative districts | `id`, `name`, `slug`, `province` |
| `municipalities` | Municipal areas | `id`, `district_id`, `name`, `slug` |
| `towns` | Locality records | `id`, `municipality_id`, `name`, `slug` |
| `stories` | News and feature content | `id`, `title`, `status`, `author_id`, `slug`, `published_at`, `archived_at` |
| `editorial_reviews` | Editorial QA scores and review notes | `story_id`, `quality_score`, `fact_check_status` |
| `revision_history` | Workflow and status history | `story_id`, `action`, `previous_status`, `new_status` |
| `editorial_notes` | Editor feedback | `story_id`, `user_id`, `note` |
| `story_corrections` | Correction tickets tied to a story | `story_id`, `user_id`, `note` |
| `comments` | Reader comments | `story_id`, `author_name`, `status`, `created_at` |
| `advertisers` | Advertising clients | `id`, `business_name`, `status`, `website` |
| `ad_campaigns` | Campaigns grouped under an advertiser | `id`, `advertiser_id`, `status`, `start_date`, `end_date` |
| `advertisements` | Individual placements | `id`, `campaign_id`, `placement`, `destination_url` |
| `ad_impressions` | Impression tracking | `advertisement_id`, `campaign_id`, `created_at` |
| `ad_clicks` | Click tracking | `advertisement_id`, `campaign_id`, `created_at` |
| `correction_requests` | Public correction submissions | `name`, `email`, `article_url`, `status` |
| `media` | Media library assets | `id`, `original_name`, `stored_name`, `public_url`, `author_id` |
| `breaking_news` | Breaking story banner feed | `id`, `headline`, `article_id`, `status` |
| `newsletter_subscribers` | Email list subscribers | `id`, `email`, `frequency`, `status` |
| `push_preferences` | User notification preferences | `user_id`, `categories`, `enabled` |
| `weather_locations` | Weather lookup data | `municipality`, `slug`, `temperature`, `condition` |
| `notifications` | Internal notifications and alerts | `recipient_id`, `subject`, `status`, `created_at` |
| `messages` | User message inbox records | `recipient_id`, `subject`, `message`, `status` |
| `artists` | Creative industries profiles | `slug`, `full_name`, `province`, `verified` |
| `artist_bookings` | Booking requests | `artist_id`, `client_name`, `event_date`, `status` |
| `artist_reviews` | Artistic profile reviews | `artist_id`, `reviewer_name`, `rating` |
| `creative_organisations` | Community organisations | `slug`, `name`, `province`, `featured` |
| `venues` | Event venue directory | `slug`, `name`, `category`, `featured` |
| `events` | Community events | `slug`, `title`, `start_date`, `end_date` |
| `opportunities` | Calls and opportunities | `slug`, `title`, `deadline`, `featured` |
| `schema_migrations` | Migration tracking table | `migration_name`, `executed_at` |

## Relationship notes

- `stories.author_id` references `users.id`.
- `stories.district_id`, `municipality_id`, and `town_id` reference geography tables.
- `editorial_reviews.story_id` is unique per story.
- `comments.story_id` maps to the parent story and supports moderation status.
- `advertisements.campaign_id` references `ad_campaigns.id`.
- `ad_impressions` and `ad_clicks` are linked to both an ad and a parent campaign.
- `media.author_id` references `users.id` and keeps file attribution.
- `notifications`, `messages`, and `push_preferences` track communication and user audience preferences.

## Production migration strategy

- SQLite remains the default local/test fallback for repository checks.
- MariaDB/MySQL is the preferred production database via `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` settings.
- The migration runner executes SQL files under `migrations/` in order and records completed migrations in `schema_migrations`.
- Data import from the existing SQLite database is handled by the importer script in `scripts/db-import-sqlite.js`.
